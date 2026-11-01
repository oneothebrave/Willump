import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  POWER_OFF_CONTROL_HEADER,
  POWER_OFF_CONTROL_PATH,
  POWER_OFF_CONTROL_VALUE,
  createDeviceCommandAckMessage,
  createDeviceHelloMessage,
} from "../src/domain/statusProtocol";
import { createBridgeServer, isLoopbackAddress } from "./statusBroadcaster";

async function freePort() {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return port;
}

async function startBridge(powerOffAckTimeoutMs = 100) {
  const port = await freePort();
  const bridge = createBridgeServer({
    host: "127.0.0.1",
    port,
    statusPath: "/status",
    bridgeSource: "codex-cli-hooks",
    powerOffAckTimeoutMs,
  });
  await new Promise<void>((resolve) => bridge.listen(resolve));
  return { bridge, port };
}

async function connectDevice(port: number) {
  const device = new WebSocket(`ws://127.0.0.1:${port}/status`);
  const [hello] = await once(device, "message");
  assert.equal(JSON.parse(hello.toString()).kind, "bridge.hello");
  return device;
}

async function registerDevice(device: WebSocket) {
  device.send(JSON.stringify(createDeviceHelloMessage()));
  await delay(20);
}

function postPowerOff(
  port: number,
  options: { path?: string; method?: string; headers?: Record<string, string> } = {},
) {
  return fetch(`http://127.0.0.1:${port}${options.path ?? POWER_OFF_CONTROL_PATH}`, {
    method: options.method ?? "POST",
    headers: options.headers ?? { [POWER_OFF_CONTROL_HEADER]: POWER_OFF_CONTROL_VALUE },
  });
}

async function closeBridge(bridge: ReturnType<typeof createBridgeServer>, sockets: WebSocket[]) {
  for (const socket of sockets) {
    socket.terminate();
  }
  await new Promise<void>((resolve) => bridge.close(resolve));
}

test("control endpoint requires loopback, POST, exact path, and the CLI header", async () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.5"), false);
  assert.equal(isLoopbackAddress(undefined), false);

  const { bridge, port } = await startBridge();
  try {
    const wrongPath = await postPowerOff(port, { path: "/control/other" });
    assert.equal(wrongPath.status, 404);

    const wrongMethod = await postPowerOff(port, { method: "GET" });
    assert.equal(wrongMethod.status, 405);

    const missingHeader = await postPowerOff(port, { headers: {} });
    assert.equal(missingHeader.status, 403);

    const wrongHeader = await postPowerOff(port, {
      headers: { [POWER_OFF_CONTROL_HEADER]: "other" },
    });
    assert.equal(wrongHeader.status, 403);

    const browserOrigin = await postPowerOff(port, {
      headers: {
        [POWER_OFF_CONTROL_HEADER]: POWER_OFF_CONTROL_VALUE,
        origin: "http://example.test",
      },
    });
    assert.equal(browserOrigin.status, 403);

    const preflight = await postPowerOff(port, {
      method: "OPTIONS",
      headers: {
        origin: "http://example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": POWER_OFF_CONTROL_HEADER,
      },
    });
    assert.equal(preflight.status, 405);
  } finally {
    await closeBridge(bridge, []);
  }
});

test("no registered firmware returns a clear no-device result", async () => {
  const { bridge, port } = await startBridge();
  try {
    const response = await postPowerOff(port);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      target: 0,
      acknowledged: 0,
      timedOut: 0,
      error: "no_registered_devices",
    });
  } finally {
    await closeBridge(bridge, []);
  }
});

test("all registered devices acknowledge with one unique command each", async () => {
  const { bridge, port } = await startBridge();
  const first = await connectDevice(port);
  const second = await connectDevice(port);
  try {
    await registerDevice(first);
    await registerDevice(second);
    const firstCommand = once(first, "message");
    const secondCommand = once(second, "message");
    const responsePromise = postPowerOff(port);
    const [[firstRaw], [secondRaw]] = await Promise.all([firstCommand, secondCommand]);
    const firstMessage = JSON.parse(firstRaw.toString());
    const secondMessage = JSON.parse(secondRaw.toString());

    assert.equal(firstMessage.kind, "device.command");
    assert.equal(firstMessage.version, 1);
    assert.equal(firstMessage.action, "poweroff");
    assert.equal(secondMessage.kind, "device.command");
    assert.equal(secondMessage.action, "poweroff");
    assert.notEqual(firstMessage.id, secondMessage.id);
    assert.ok(firstMessage.id.length > 0 && firstMessage.id.length <= 64);

    first.send(JSON.stringify(createDeviceCommandAckMessage({ id: firstMessage.id })));
    second.send(JSON.stringify(createDeviceCommandAckMessage({ id: secondMessage.id })));

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      target: 2,
      acknowledged: 2,
      timedOut: 0,
    });
  } finally {
    await closeBridge(bridge, [first, second]);
  }
});

test("wrong and duplicate acknowledgements do not corrupt the count", async () => {
  const { bridge, port } = await startBridge();
  const device = await connectDevice(port);
  try {
    await registerDevice(device);
    const commandEvent = once(device, "message");
    const responsePromise = postPowerOff(port);
    const [raw] = await commandEvent;
    const command = JSON.parse(raw.toString());

    device.send(
      JSON.stringify({
        kind: "device.command.ack",
        version: 1,
        id: command.id,
        action: "reboot",
      }),
    );
    device.send(JSON.stringify(createDeviceCommandAckMessage({ id: command.id })));
    device.send(JSON.stringify(createDeviceCommandAckMessage({ id: command.id })));

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      target: 1,
      acknowledged: 1,
      timedOut: 0,
    });
  } finally {
    await closeBridge(bridge, [device]);
  }
});

test("partial acknowledgements return nonzero status with accurate counts", async () => {
  const { bridge, port } = await startBridge();
  const first = await connectDevice(port);
  const second = await connectDevice(port);
  try {
    await registerDevice(first);
    await registerDevice(second);
    const firstCommand = once(first, "message");
    const secondCommand = once(second, "message");
    const responsePromise = postPowerOff(port);
    const [[firstRaw]] = await Promise.all([firstCommand, secondCommand]);
    const command = JSON.parse(firstRaw.toString());

    first.send(JSON.stringify(createDeviceCommandAckMessage({ id: command.id })));

    const response = await responsePromise;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
      ok: false,
      target: 2,
      acknowledged: 1,
      timedOut: 1,
      error: "incomplete_acknowledgements",
    });
  } finally {
    await closeBridge(bridge, [first, second]);
  }
});

test("timeout, late ACK, and close during wait are bounded and accurate", async () => {
  const { bridge, port } = await startBridge(80);
  const device = await connectDevice(port);
  try {
    await registerDevice(device);
    const firstCommand = once(device, "message");
    const firstResponsePromise = postPowerOff(port);
    const [firstRaw] = await firstCommand;
    const firstCommandMessage = JSON.parse(firstRaw.toString());

    const firstResponse = await firstResponsePromise;
    assert.equal(firstResponse.status, 504);
    assert.deepEqual(await firstResponse.json(), {
      ok: false,
      target: 1,
      acknowledged: 0,
      timedOut: 1,
      error: "incomplete_acknowledgements",
    });

    device.send(JSON.stringify(createDeviceCommandAckMessage({ id: firstCommandMessage.id })));

    const secondCommand = once(device, "message");
    const secondResponsePromise = postPowerOff(port);
    const [secondRaw] = await secondCommand;
    const secondCommandMessage = JSON.parse(secondRaw.toString());
    device.send(JSON.stringify(createDeviceCommandAckMessage({ id: secondCommandMessage.id })));
    const secondResponse = await secondResponsePromise;
    assert.equal(secondResponse.status, 200);

    const thirdCommand = once(device, "message");
    const thirdResponsePromise = postPowerOff(port, {
      headers: { [POWER_OFF_CONTROL_HEADER]: POWER_OFF_CONTROL_VALUE },
    });
    await thirdCommand;
    device.close();
    const thirdResponse = await thirdResponsePromise;
    assert.equal(thirdResponse.status, 504);
    assert.deepEqual(await thirdResponse.json(), {
      ok: false,
      target: 1,
      acknowledged: 0,
      timedOut: 1,
      error: "incomplete_acknowledgements",
    });
  } finally {
    await closeBridge(bridge, [device]);
  }
});

test("only registered devices are targets and commands are never replayed", async () => {
  const { bridge, port } = await startBridge(60);
  const observer = await connectDevice(port);
  const registered = await connectDevice(port);
  const observerMessages: unknown[] = [];
  observer.on("message", (data) => observerMessages.push(JSON.parse(data.toString())));
  try {
    await registerDevice(registered);
    const commandEvent = once(registered, "message");
    const responsePromise = postPowerOff(port);
    await commandEvent;
    await delay(20);
    assert.equal(
      observerMessages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { kind?: string }).kind === "device.command",
      ),
      false,
    );
    const response = await responsePromise;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
      ok: false,
      target: 1,
      acknowledged: 0,
      timedOut: 1,
      error: "incomplete_acknowledgements",
    });

    registered.close();
    await once(registered, "close");

    const reconnect = await connectDevice(port);
    const reconnectMessages: unknown[] = [];
    reconnect.on("message", (data) => reconnectMessages.push(JSON.parse(data.toString())));
    await registerDevice(reconnect);
    await delay(100);
    assert.equal(
      reconnectMessages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { kind?: string }).kind === "device.command",
      ),
      false,
    );
    reconnect.close();
    await once(reconnect, "close");
  } finally {
    await closeBridge(bridge, [observer, registered]);
  }
});
