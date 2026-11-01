import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  bridgeSettings,
  settings,
  health,
  canBind,
  inspect,
  createDiagnosticReporter,
} from "./indicator.mjs";

async function listener(handler, host = "127.0.0.1") {
  const server = createServer(handler);
  server.listen(0, host);
  await once(server, "listening");
  return server;
}
async function freePort() {
  const server = await listener();
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function childWithEnv(config, env, args) {
  const childProcess = spawn(process.execPath, ["scripts/indicator.mjs", ...args], {
    env: {
      ...process.env,
      AGENT_INDICATOR_HOST: "127.0.0.1",
      AGENT_INDICATOR_PORT: String(config.port),
      AGENT_INDICATOR_HOOK_PORT: String(config.hookPort),
      AGENT_INDICATOR_SOURCE: "codex",
      AGENT_INDICATOR_CODEX_PROMPT: "must not start an app-server task",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  childProcess.stdout.on("data", (chunk) => {
    output += chunk;
  });
  childProcess.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return { p: childProcess, output: () => output, ended: once(childProcess, "exit") };
}
function child(config, ...args) {
  return childWithEnv(config, {}, args);
}
async function until(fn) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await fn()) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for bridge");
}
async function stubBridge(source, control, host = "127.0.0.1") {
  let received;
  const server = await listener((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ ok: true, service: "agent-indicator-bridge", source }),
      );
      return;
    }
    received = {
      method: request.method,
      path: request.url,
      header: request.headers["x-willump-control"],
    };
    control(request, response);
  }, host);
  return {
    server,
    port: server.address().port,
    received: () => received,
  };
}
async function closeStub(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("reject invalid and colliding port configuration", () => {
  for (const port of ["0", "-1", "abc", "65536", "1.5", "8788"]) {
    assert.throws(() => settings({ AGENT_INDICATOR_PORT: port }));
  }
});

test("read-only bridge consumers do not depend on a hooks listener configuration", () => {
  assert.equal(
    bridgeSettings({ AGENT_INDICATOR_PORT: "8788", AGENT_INDICATOR_HOOK_PORT: "invalid" }).port,
    8788,
  );
});

test("diagnostics report observer degradation and recovery without timestamp spam", () => {
  const printed = [];
  const report = createDiagnosticReporter((status) =>
    printed.push(status.hooks.terminalObserver.phase),
  );
  const status = (phase, error = null, lastReadAt = 0) => ({
    bridgeOK: true,
    hooksOK: true,
    bridge: { clients: 1 },
    hooks: { terminalObserver: { phase, error, lastReadAt } },
  });
  report(status("reading"));
  report(status("reading", null, 100));
  report(status("missing"));
  report(status("ambiguous"));
  report(status("error", "EACCES"));
  report(status("error", "ENOENT"));
  report(status("reading", null, 200));
  assert.deepEqual(printed, ["reading", "missing", "ambiguous", "error", "error", "reading"]);
});

test("diagnostics report CLI observer degradation without unrelated refreshes", () => {
  const printed = [];
  const report = createDiagnosticReporter((status) => printed.push(status.hooks.cliObserver.phase));
  const status = (phase, error) => ({
    bridgeOK: true,
    hooksOK: true,
    bridge: { clients: 1 },
    hooks: { cliObserver: { phase, error } },
  });
  report(status("watching"));
  report(status("watching"));
  report(status("degraded", "process-wait-unavailable"));
  report(status("watching"));
  report(status("unbound"));
  assert.deepEqual(printed, ["watching", "degraded", "watching", "unbound"]);
});

test("health bounds stalled responses and detects occupied ports", async () => {
  const server = await listener((_req, res) => {
    res.writeHead(200);
    res.write("{");
  });
  try {
    const port = server.address().port;
    assert.equal((await canBind("127.0.0.1", port)).free, false);
    const start = Date.now();
    assert.equal(await health("127.0.0.1", port), null);
    assert.ok(Date.now() - start < 2500);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("foreign service conflict does not terminate the occupied server", async () => {
  const server = await listener((_req, res) =>
    res.end(JSON.stringify({ ok: true, source: "mock" })),
  );
  try {
    const run = child({ port: server.address().port, hookPort: await freePort() });
    const [code] = await run.ended;
    assert.equal(code, 1, run.output());
    assert.match(run.output(), /端口.*不可用/);
    assert.equal((await health("127.0.0.1", server.address().port)).source, "mock");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test(
  "poweroff CLI contacts an existing bridge and reports acknowledgement counts",
  { timeout: 20000 },
  async () => {
    const noBridgePort = await freePort();
    const noBridge = child(
      { port: noBridgePort, hookPort: await freePort() },
      "--poweroff",
    );
    assert.equal((await noBridge.ended)[0], 1, noBridge.output());
    assert.match(noBridge.output(), /未找到正在运行的本地 bridge/);

    const wrongSource = await stubBridge("mock", () => {});
    try {
      const run = child({ port: wrongSource.port, hookPort: await freePort() }, "--poweroff");
      assert.equal((await run.ended)[0], 1, run.output());
      assert.match(run.output(), /不是 CLI bridge/);
    } finally {
      await closeStub(wrongSource.server);
    }

    const noDevices = await stubBridge("codex-cli-hooks", (_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          target: 0,
          acknowledged: 0,
          timedOut: 0,
          error: "no_registered_devices",
        }),
      );
    });
    try {
      const run = child({ port: noDevices.port, hookPort: await freePort() }, "--poweroff");
      assert.equal((await run.ended)[0], 1, run.output());
      assert.match(run.output(), /没有已注册的固件设备/);
      assert.deepEqual(noDevices.received(), {
        method: "POST",
        path: "/control/poweroff",
        header: "poweroff",
      });
    } finally {
      await closeStub(noDevices.server);
    }

    const allAcknowledged = await stubBridge("codex-cli-hooks", (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, target: 2, acknowledged: 2, timedOut: 0 }));
    });
    try {
      const run = child(
        { port: allAcknowledged.port, hookPort: await freePort() },
        "--poweroff",
      );
      assert.equal((await run.ended)[0], 0, run.output());
      assert.match(run.output(), /目标 2 台，已确认 2 台，超时 0 台/);
      assert.match(run.output(), /ACK 只表示已调度/);
    } finally {
      await closeStub(allAcknowledged.server);
    }

    const partial = await stubBridge("codex-cli-hooks", (_request, response) => {
      response.writeHead(504, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          target: 2,
          acknowledged: 1,
          timedOut: 1,
          error: "incomplete_acknowledgements",
        }),
      );
    });
    try {
      const run = child({ port: partial.port, hookPort: await freePort() }, "--poweroff");
      assert.equal((await run.ended)[0], 1, run.output());
      assert.match(run.output(), /目标 2 台，已确认 1 台，超时 1 台/);
      assert.match(run.output(), /部分或全部设备未确认/);
    } finally {
      await closeStub(partial.server);
    }

    const zeroAcknowledged = await stubBridge("codex-cli-hooks", (_request, response) => {
      response.writeHead(504, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          target: 1,
          acknowledged: 0,
          timedOut: 1,
          error: "incomplete_acknowledgements",
        }),
      );
    });
    try {
      const run = child(
        { port: zeroAcknowledged.port, hookPort: await freePort() },
        "--poweroff",
      );
      assert.equal((await run.ended)[0], 1, run.output());
      assert.match(run.output(), /目标 1 台，已确认 0 台，超时 1 台/);
    } finally {
      await closeStub(zeroAcknowledged.server);
    }

    const stalled = await stubBridge("codex-cli-hooks", () => {});
    try {
      const run = child({ port: stalled.port, hookPort: await freePort() }, "--poweroff");
      assert.equal((await run.ended)[0], 1, run.output());
      assert.match(run.output(), /未在限定时间内返回确认结果/);
    } finally {
      await closeStub(stalled.server);
    }
  },
);

test(
  "poweroff preserves an explicitly bound 127/8 loopback host",
  { timeout: 10000 },
  async (context) => {
    if (!(await canBind("127.0.0.2", await freePort())).free) {
      context.skip("Alternate IPv4 loopback address unavailable");
      return;
    }
    const stub = await stubBridge(
      "codex-cli-hooks",
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, target: 1, acknowledged: 1, timedOut: 0 }));
      },
      "127.0.0.2",
    );
    try {
      const run = childWithEnv(
        { port: stub.port, hookPort: await freePort() },
        { AGENT_INDICATOR_HOST: "127.0.0.2" },
        ["--poweroff"],
      );
      assert.equal((await run.ended)[0], 0, run.output());
      assert.match(run.output(), /目标 1 台，已确认 1 台，超时 0 台/);
      assert.deepEqual(stub.received(), {
        method: "POST",
        path: "/control/poweroff",
        header: "poweroff",
      });
    } finally {
      await closeStub(stub.server);
    }
  },
);

test(
  "fresh startup, reuse, doctor, websocket reconnect and hook delivery",
  { timeout: 20000 },
  async () => {
    const config = {
      host: "127.0.0.1",
      probeHost: "127.0.0.1",
      port: await freePort(),
      hookPort: await freePort(),
    };
    const run = child(config);
    let ws;
    try {
      await until(async () => (await inspect(config)).ready);
      assert.equal((await inspect(config)).bridge.clients, 0);
      // Request parsing remains strict after separating the HTTP handler.
      const invalidRequests = [
        { path: "/unknown", method: "POST", body: "{}", status: 404 },
        { path: "/hook", method: "PUT", body: "{}", status: 404 },
        { path: "/hook", contentType: "text/plain", body: "{}", status: 415 },
        { path: "/hook", body: "{", status: 400 },
        { path: "/hook", body: "{}", status: 400 },
        { path: "/session/reset", body: "null", status: 400 },
        { path: "/session/reset", body: "[]", status: 400 },
        {
          path: "/session/reset",
          body: JSON.stringify({ expectedSessionId: 42, expectedTurnId: null }),
          status: 400,
        },
      ];
      for (const invalidRequest of invalidRequests) {
        const result = await fetch(`http://127.0.0.1:${config.hookPort}${invalidRequest.path}`, {
          method: invalidRequest.method ?? "POST",
          headers: { "content-type": invalidRequest.contentType ?? "application/json" },
          body: invalidRequest.body,
        });
        assert.equal(result.status, invalidRequest.status);
        assert.deepEqual(await result.json(), {});
      }
      assert.equal((await inspect(config)).hooks.accepted, 0);
      for (let attempt = 0; attempt < 2; attempt++) {
        ws = new WebSocket(`ws://127.0.0.1:${config.port}/status`);
        const [hello] = await once(ws, "message");
        assert.equal(JSON.parse(hello).kind, "bridge.hello");
        await until(async () => (await inspect(config)).bridge.clients === 1);
        ws.close();
        await once(ws, "close");
        await until(async () => (await inspect(config)).bridge.clients === 0);
      }
      const response = await fetch(`http://127.0.0.1:${config.hookPort}/hook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "startup-test",
          hook_event_name: "UserPromptSubmit",
          session_id: "test-session",
          turn_id: "test-turn",
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await inspect(config)).bridge.latestAgentEvent.type, "turn.started");
      const rejected = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://example.test" },
        body: JSON.stringify({ expectedSessionId: "test-session" }),
      });
      assert.equal(rejected.status, 403);
      const stale = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSessionId: "stale", expectedTurnId: "test-turn" }),
      });
      assert.equal(stale.status, 409);
      const oldTurn = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSessionId: "test-session", expectedTurnId: "old-turn" }),
      });
      assert.equal(oldTurn.status, 409);
      const missingTurn = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSessionId: "test-session" }),
      });
      assert.equal(missingTurn.status, 400);
      const reset = child(config, "--reset-session");
      assert.equal((await reset.ended)[0], 0, reset.output());
      assert.equal((await inspect(config)).hooks.sessionId, null);
      assert.equal((await inspect(config)).bridge.latestAgentEvent.type, "thread.idle");
      for (const args of [[], ["--check"]]) {
        const duplicate = child(config, ...args);
        assert.equal((await duplicate.ended)[0], 0, duplicate.output());
        if (!args.length) {
          assert.match(duplicate.output(), /复用现有服务/);
        }
      }
    } finally {
      ws?.terminate();
      run.p.kill();
      await run.ended;
    }
    const offline = child(config, "--check");
    assert.equal((await offline.ended)[0], 1, offline.output());
  },
);
