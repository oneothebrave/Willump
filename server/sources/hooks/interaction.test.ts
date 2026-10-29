import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";
import type { StatusMessage } from "../../../src/domain/statusProtocol";
import { createHookEventPublisher, type HookEvent } from "./events";
import { createInteractionWatcher } from "./interaction";

async function runtime(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "willump-interaction-"));
  const path = join(directory, "runtime.sock");
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  const requests: Record<string, unknown>[] = [];
  let status: unknown = { type: "active", activeFlags: [] };
  let onRead: ((socket: WebSocket, message: any) => void) | undefined;
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      requests.push(message);
      if (message.method === "initialize") {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      } else if (message.method === "thread/read") {
        if (onRead) {
          onRead(socket, message);
        } else {
          socket.send(
            JSON.stringify({
              id: message.id,
              result: {
                thread: { id: message.params.threadId, status, preview: "private prompt" },
              },
            }),
          );
        }
      }
    });
  });
  server.listen(path);
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    path,
    requests,
    sockets,
    setStatus(value: unknown) {
      status = value;
    },
    setRead(handler: typeof onRead) {
      onRead = handler;
    },
  };
}

const unsupported = process.platform === "win32";
test(
  "reads real approval/input flags and never answers server requests",
  { skip: unsupported },
  async (context) => {
    const server = await runtime(context);
    const observed: (boolean | null)[] = [];
    const watcher = createInteractionWatcher(
      server.path,
      () => ({ sessionId: "s", turnId: "t" }),
      (_session, _turn, waiting) => observed.push(waiting),
      { intervalMs: 60000 },
    );
    context.after(() => watcher.stop());
    await watcher.poll();
    server.setStatus({ type: "active", activeFlags: ["waitingOnApproval"] });
    await watcher.poll();
    server.setStatus({ type: "active", activeFlags: ["waitingOnUserInput"] });
    await watcher.poll();
    server.setStatus({ type: "active", activeFlags: [] });
    for (const socket of server.sockets.clients) {
      socket.send(
        JSON.stringify({ id: "not-ours", method: "item/tool/requestUserInput", params: {} }),
      );
    }
    await watcher.poll();
    assert.deepEqual(observed, [false, true, true, false]);
    assert.equal(watcher.status().phase, "reading");
    assert.ok(watcher.status().lastReadAt);
    assert.equal(
      server.requests.some((request) => request.id === "not-ours"),
      false,
    );
    assert.ok(
      server.requests.every((request) =>
        ["initialize", "initialized", "thread/read"].includes(String(request.method)),
      ),
    );
    assert.ok(
      server.requests
        .filter((request) => request.method === "thread/read")
        .every((request: any) => request.params.includeTurns === false),
    );
    assert.equal(JSON.stringify(watcher.status()).includes("private"), false);
  },
);

test(
  "cleared waitingOnApproval synchronously restores the active command",
  { skip: unsupported },
  async (context) => {
    const server = await runtime(context);
    const messages: StatusMessage[] = [];
    const publisher = createHookEventPublisher((message) => messages.push(message), undefined, {
      runtimeInteractions: true,
    });
    const event = (
      name: HookEvent["hook_event_name"],
      id: string,
      fields: Partial<HookEvent> = {},
    ): HookEvent => ({
      id,
      hook_event_name: name,
      session_id: "s",
      turn_id: "t",
      ...fields,
    });
    publisher.receive(event("UserPromptSubmit", "prompt"));
    publisher.receive(event("PreToolUse", "tool", { tool_name: "Bash", tool_use_id: "shell" }));
    const watcher = createInteractionWatcher(
      server.path,
      publisher.status,
      publisher.observeInteraction,
      { intervalMs: 60000 },
    );
    context.after(() => watcher.stop());
    const last = () => {
      const message = messages[messages.length - 1];
      return message.kind === "agent.event" ? message.event.type : undefined;
    };

    server.setStatus({ type: "active", activeFlags: ["waitingOnApproval"] });
    await watcher.poll();
    assert.equal(last(), "approval.requested");
    assert.equal(publisher.status().waitingForUser, true);

    const beforeClear = messages.length;
    server.setStatus({ type: "active", activeFlags: [] });
    await watcher.poll();
    assert.equal(messages.length, beforeClear + 1);
    assert.equal(last(), "command.started");
    assert.equal(publisher.status().activeTools, 1);
    assert.equal(publisher.status().waitingForUser, false);
  },
);

test(
  "a delayed response from an old binding is ignored",
  { skip: unsupported },
  async (context) => {
    const server = await runtime(context);
    let binding = { sessionId: "old", turnId: "old-turn" };
    const observed: unknown[] = [];
    const watcher = createInteractionWatcher(
      server.path,
      () => binding,
      (...value) => observed.push(value),
      { intervalMs: 60000 },
    );
    context.after(() => watcher.stop());
    let deliver!: () => void;
    let ready!: () => void;
    const reading = new Promise<void>((resolve) => {
      ready = resolve;
    });
    server.setRead((socket, message) => {
      deliver = () =>
        socket.send(
          JSON.stringify({
            id: message.id,
            result: {
              thread: { id: "old", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
            },
          }),
        );
      ready();
    });
    const polling = watcher.poll();
    await reading;
    binding = { sessionId: "new", turnId: "new-turn" };
    deliver();
    await polling;
    assert.deepEqual(observed, []);
    server.setRead(undefined);
    await watcher.poll();
    assert.deepEqual(observed, [["new", "new-turn", false]]);
  },
);

test(
  "not-loaded and malformed thread statuses use fallback, then recover",
  { skip: unsupported },
  async (context) => {
    const server = await runtime(context);
    const observed: (boolean | null)[] = [];
    const watcher = createInteractionWatcher(
      server.path,
      () => ({ sessionId: "s", turnId: "t" }),
      (_s, _t, waiting) => observed.push(waiting),
      { intervalMs: 60000 },
    );
    context.after(() => watcher.stop());
    server.setStatus({ type: "notLoaded" });
    await watcher.poll();
    assert.equal(watcher.status().phase, "unavailable");
    server.setStatus({ type: "active", activeFlags: "waitingOnApproval" });
    await watcher.poll();
    server.setStatus({ type: "active", activeFlags: [] });
    await watcher.poll();
    assert.deepEqual(observed, [null, null, false]);
  },
);

test(
  "a timed-out read falls back and can reconnect; stop suppresses late callbacks",
  { skip: unsupported },
  async (context) => {
    const server = await runtime(context);
    const observed: (boolean | null)[] = [];
    const watcher = createInteractionWatcher(
      server.path,
      () => ({ sessionId: "s", turnId: "t" }),
      (_s, _t, waiting) => observed.push(waiting),
      { intervalMs: 60000, timeoutMs: 100, retryMs: 0 },
    );
    context.after(() => watcher.stop());
    server.setRead(() => {});
    await watcher.poll();
    assert.equal(watcher.status().error, "runtime_timeout");
    server.setRead(undefined);
    await watcher.poll();
    assert.deepEqual(observed, [null, false]);
    watcher.stop();
    await watcher.poll();
    assert.deepEqual(observed, [null, false]);
    assert.equal(watcher.status().phase, "stopped");
  },
);
