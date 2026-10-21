import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asyncInputSignal,
  createTerminalFailureWatcher,
  hasTerminalFailure,
} from "./terminalFailure";
import { mkdtemp, writeFile, appendFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookEventPublisher } from "./events";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

test("only explicit terminal errors on the selected turn qualify", () => {
  const record = (type: string, turn_id: string, error: unknown) =>
    JSON.stringify({ type: "event_msg", payload: { type, turn_id, error } });
  assert.equal(hasTerminalFailure(record("task_complete", "a", { message: "404" }), "a"), true);
  assert.equal(hasTerminalFailure(record("task_complete", "b", { message: "404" }), "a"), false);
  assert.equal(hasTerminalFailure(record("task_complete", "a", null), "a"), false);
  assert.equal(hasTerminalFailure(record("warning", "a", { message: "retry" }), "a"), false);
  assert.equal(hasTerminalFailure('{"partial":', "a"), false);
});

const inputRecord = (turn: string, item: Record<string, unknown>) =>
  JSON.stringify({
    type: "event_msg",
    payload: { type: "item_completed", turn_id: turn, item },
  }) + "\n";

test("async input recognition uses typed metadata, never message wording or other turns", () => {
  const question = { type: "AgentMessage", id: "q", questions: [{ title: "private question" }] };
  assert.deepEqual(asyncInputSignal(inputRecord("t", question), "t"), { id: "q", waiting: true });
  assert.equal(asyncInputSignal(inputRecord("other", question), "t"), undefined);
  assert.equal(
    asyncInputSignal(
      inputRecord("t", { type: "CommandExecution", id: "cmd", questions: question.questions }),
      "t",
    ),
    undefined,
  );
  assert.equal(
    asyncInputSignal(
      inputRecord("t", { type: "AgentMessage", id: "text", content: "Do you approve?" }),
      "t",
    ),
    undefined,
  );
  assert.deepEqual(
    asyncInputSignal(
      inputRecord("t", { type: "UserMessage", id: "reply", content: "private reply" }),
      "t",
    ),
    { id: "reply", waiting: false },
  );
});

test("async metadata watcher waits for complete records and commits replies without waiting for tool completion", async () => {
  const files = await fixture();
  const observed: boolean[] = [];
  const watcher = createTerminalFailureWatcher(
    files.root,
    () => ({ sessionId: "session", turnId: "t" }),
    () => {},
    { onAsyncInput: (_s, _t, waiting) => observed.push(waiting) },
  );
  const question = inputRecord("t", {
    type: "AgentMessage",
    id: "q",
    questions: [{ title: "private" }],
  });
  try {
    await writeFile(files.path, question.slice(0, -1));
    await watcher.poll();
    assert.deepEqual(observed, []);
    await appendFile(files.path, "\n");
    await watcher.poll();
    assert.deepEqual(observed, [true]);
    await appendFile(files.path, inputRecord("t", { type: "UserMessage", id: "answer" }));
    await watcher.poll();
    assert.deepEqual(observed, [true, false]);
    // Replayed question metadata cannot resurrect an answered card.
    await appendFile(files.path, question);
    await watcher.poll();
    assert.deepEqual(observed, [true, false, false]);
  } finally {
    watcher.stop();
    await files.clean();
  }
});

test("replaying old question history does not flash waiting, and stale turns cannot clear a new question", async () => {
  const files = await fixture();
  let turnId = "old";
  const observed: { turn: string; waiting: boolean }[] = [];
  const watcher = createTerminalFailureWatcher(
    files.root,
    () => ({ sessionId: "session", turnId }),
    () => {},
    { bytesPerPoll: 80, onAsyncInput: (_s, turn, waiting) => observed.push({ turn, waiting }) },
  );
  try {
    await writeFile(
      files.path,
      inputRecord("old", { type: "AgentMessage", id: "old-q", questions: [{}] }) +
        inputRecord("old", { type: "UserMessage", id: "old-answer" }),
    );
    for (let i = 0; i < 10; i++) await watcher.poll();
    assert.ok(observed.length > 0 && observed.every((event) => !event.waiting));
    turnId = "new";
    await appendFile(
      files.path,
      inputRecord("new", { type: "AgentMessage", id: "new-q", questions: [{}] }) +
        inputRecord("old", { type: "UserMessage", id: "delayed-answer" }),
    );
    for (let i = 0; i < 10; i++) await watcher.poll();
    assert.deepEqual(observed[observed.length - 1], { turn: "new", waiting: true });
  } finally {
    watcher.stop();
    await files.clean();
  }
});

test("terminal error releases tools, holds error and ignores delayed hooks", () => {
  const out: StatusMessage[] = [];
  const publisher = createHookEventPublisher((message) => out.push(message));
  publisher.receive({
    id: "1",
    session_id: "a",
    turn_id: "t",
    hook_event_name: "UserPromptSubmit",
  });
  publisher.receive({
    id: "2",
    session_id: "a",
    turn_id: "t",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool",
  });
  assert.equal(publisher.failTurn("b", "t"), false);
  assert.equal(publisher.failTurn("a", "other"), false);
  assert.equal(publisher.failTurn("a", "t"), true);
  assert.equal(publisher.status().activeTools, 0);
  assert.equal(publisher.failTurn("a", "t"), false);
  assert.equal(
    publisher.receive({ id: "3", session_id: "a", turn_id: "t", hook_event_name: "Stop" }),
    false,
  );
  const last = out[out.length - 1];
  assert.equal(last.kind === "agent.event" && last.event.type, "turn.failed");
  assert.equal(
    publisher.receive({
      id: "4",
      session_id: "a",
      turn_id: "new",
      hook_event_name: "UserPromptSubmit",
    }),
    true,
  );
});

test("new CLI prompt takes over after failure, stale tools cannot overwrite it", () => {
  const out: StatusMessage[] = [];
  const publisher = createHookEventPublisher((message) => out.push(message));
  const prompt = (id: string, session_id: string, turn_id: string) =>
    publisher.receive({ id, session_id, turn_id, hook_event_name: "UserPromptSubmit" });
  prompt("1", "old", "failed");
  publisher.failTurn("old", "failed");
  assert.equal(
    publisher.receive({
      id: "2",
      session_id: "new",
      turn_id: "new-turn",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "x",
    }),
    false,
  );
  assert.equal(prompt("3", "new", "new-turn"), true);
  assert.equal(publisher.status().sessionId, "new");
  assert.equal(
    publisher.receive({ id: "4", session_id: "old", hook_event_name: "SessionEnd" }),
    false,
  );
  assert.equal(prompt("5", "old", "failed"), false);
  assert.equal(publisher.failTurn("old", "failed"), false);
  assert.equal(
    publisher.receive({
      id: "6",
      session_id: "new",
      turn_id: "new-turn",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "y",
    }),
    true,
  );
  const last = out[out.length - 1];
  assert.equal(last.kind === "agent.event" && last.event.type, "command.started");
});

test("failure takeover respects pinned sessions and active ownership", () => {
  for (const pinned of [undefined, "old"]) {
    const publisher = createHookEventPublisher(() => {}, pinned);
    publisher.receive({
      id: "1",
      session_id: "old",
      turn_id: "t",
      hook_event_name: "UserPromptSubmit",
    });
    assert.equal(
      publisher.receive({
        id: "2",
        session_id: "new",
        turn_id: "n",
        hook_event_name: "UserPromptSubmit",
      }),
      false,
    );
    publisher.failTurn("old", "t");
    assert.equal(
      publisher.receive({
        id: "3",
        session_id: "new",
        turn_id: "n",
        hook_event_name: "UserPromptSubmit",
      }),
      !pinned,
    );
  }
});

test("terminal failure corrects current completion, never cancellation or a newer turn", () => {
  const publisher = createHookEventPublisher(() => {});
  publisher.receive({
    id: "1",
    session_id: "s",
    turn_id: "t",
    hook_event_name: "UserPromptSubmit",
  });
  publisher.receive({ id: "2", session_id: "s", turn_id: "t", hook_event_name: "Stop" });
  assert.equal(publisher.failTurn("s", "t"), true);
  assert.equal(publisher.failTurn("s", "t"), false);
  publisher.receive({
    id: "3",
    session_id: "s",
    turn_id: "next",
    hook_event_name: "UserPromptSubmit",
  });
  assert.equal(publisher.failTurn("s", "t"), false);
  publisher.receive({ id: "4", session_id: "s", turn_id: "next", hook_event_name: "Interrupt" });
  assert.equal(publisher.failTurn("s", "next"), false);
});

const terminal = (turn: string, text = "") =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: turn,
      last_agent_message: text,
      error: { message: "404" },
    },
  }) + "\n";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "indicator-watcher-test-"));
  return {
    root,
    path: join(root, "rollout-session.jsonl"),
    clean: () => rm(root, { recursive: true, force: true }),
  };
}

test("incremental watcher handles long UTF-8 records, partial writes and duplicate polls", async () => {
  const filesFixture = await fixture();
  let count = 0;
  const watcher = createTerminalFailureWatcher(
    filesFixture.root,
    () => ({ sessionId: "session", turnId: "t" }),
    () => count++,
    { bytesPerPoll: 65536 },
  );
  try {
    const bytes = Buffer.from(terminal("t", "中文".repeat(40000)));
    await writeFile(filesFixture.path, bytes.subarray(0, bytes.length - 1));
    for (let index = 0; index < 5; index++) {
      await watcher.poll();
    }
    assert.equal(count, 0);
    await appendFile(filesFixture.path, "\n");
    await watcher.poll();
    await watcher.poll();
    assert.equal(count, 1);
    assert.equal(watcher.status().phase, "reading");
  } finally {
    watcher.stop();
    await filesFixture.clean();
  }
});

test("watcher relocates missing files and resets reader on replacement or truncation", async () => {
  const filesFixture = await fixture();
  let count = 0;
  const watcher = createTerminalFailureWatcher(
    filesFixture.root,
    () => ({ sessionId: "session", turnId: "t" }),
    () => count++,
  );
  try {
    await watcher.poll();
    assert.equal(watcher.status().phase, "missing");
    await writeFile(filesFixture.path, "{}\n".repeat(100));
    await watcher.poll();
    await rename(filesFixture.path, join(filesFixture.root, "archived.jsonl"));
    await watcher.poll();
    assert.equal(watcher.status().phase, "error");
    await writeFile(filesFixture.path, terminal("t"));
    await watcher.poll();
    assert.equal(count, 1);
    await writeFile(filesFixture.path, "{}\n");
    await watcher.poll();
    await appendFile(filesFixture.path, terminal("t"));
    await watcher.poll();
    assert.equal(count, 2);
  } finally {
    watcher.stop();
    await filesFixture.clean();
  }
});

test("oversized records are diagnosed; subsequent valid records still work", async () => {
  const filesFixture = await fixture();
  let count = 0;
  const watcher = createTerminalFailureWatcher(
    filesFixture.root,
    () => ({ sessionId: "session", turnId: "t" }),
    () => count++,
    { maxRecordBytes: 512 },
  );
  try {
    await writeFile(filesFixture.path, terminal("t", "x".repeat(1000)) + terminal("t"));
    await watcher.poll();
    assert.equal(count, 1);
    assert.equal(watcher.status().oversizedRecords, 1);
    assert.equal(watcher.status().error, "record_too_large");
  } finally {
    watcher.stop();
    await filesFixture.clean();
  }
});

test("rebinding rescans existing records, stale reads and stopped callbacks are suppressed", async () => {
  const filesFixture = await fixture();
  let count = 0;
  let turnId = "old";
  const watcher = createTerminalFailureWatcher(
    filesFixture.root,
    () => ({ sessionId: "session", turnId }),
    () => count++,
  );
  try {
    await writeFile(filesFixture.path, terminal("new"));
    await watcher.poll();
    assert.equal(count, 0);
    turnId = "new";
    await watcher.poll();
    assert.equal(count, 1);
    await writeFile(filesFixture.path, terminal("later"));
    turnId = "later";
    const pending = watcher.poll();
    watcher.stop();
    await pending;
    assert.equal(count, 1);
  } finally {
    watcher.stop();
    await filesFixture.clean();
  }
});
