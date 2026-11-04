import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { createCameraFrameReceiver } from "./camera-frame-receiver.mjs";

const FRAME_BYTES = 320 * 240 * 2;

function checksumFrame(frame) {
  let checksum = 2166136261;
  for (const byte of frame) {
    checksum ^= byte;
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
  return checksum.toString(16).padStart(8, "0");
}

function sendFrame(port, frame, sequence, run = "1234abcd") {
  return fetch(`http://127.0.0.1:${port}/frame`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-willump-width": "320",
      "x-willump-height": "240",
      "x-willump-format": "rgb565",
      "x-willump-run": run,
      "x-willump-sequence": String(sequence),
      "x-willump-checksum": checksumFrame(frame),
    },
    body: frame,
  });
}

test("camera receiver validates and discards one complete RGB565 frame", async (context) => {
  const logs = [];
  const receiver = createCameraFrameReceiver({
    host: "127.0.0.1",
    port: 0,
    expectedFrames: 1,
    log: (message) => logs.push(message),
  });
  context.after(() => receiver.close());
  const address = await receiver.listen();
  const frame = Buffer.alloc(FRAME_BYTES, 0x5a);
  const checksum = checksumFrame(frame);
  const response = await sendFrame(address.port, frame, 1);

  assert.equal(response.status, 204);
  assert.deepEqual(await receiver.done, { receivedFrames: 1, bytes: FRAME_BYTES });
  assert.equal(logs.length, 1);
  assert.match(logs[0], new RegExp(`bytes=${FRAME_BYTES} checksum=${checksum}$`));
});

test("camera receiver starts a clean sequence when a reset sends sequence one again", async (context) => {
  const logs = [];
  const receiver = createCameraFrameReceiver({
    host: "127.0.0.1",
    port: 0,
    expectedFrames: 2,
    log: (message) => logs.push(message),
  });
  context.after(() => receiver.close());
  const address = await receiver.listen();
  const frame = Buffer.alloc(FRAME_BYTES, 0xa5);

  assert.equal((await sendFrame(address.port, frame, 1, "1234abcd")).status, 204);
  assert.equal((await sendFrame(address.port, frame, 1, "5678abcd")).status, 204);
  assert.equal((await sendFrame(address.port, frame, 2, "5678abcd")).status, 204);
  assert.deepEqual(await receiver.done, { receivedFrames: 2, bytes: FRAME_BYTES * 2 });
  assert.equal(
    logs.some((message) => message === "[camera-receiver] new-run discarded=1"),
    true,
  );
});

test("camera receiver acknowledges a retried sequence without counting it twice", async (context) => {
  const logs = [];
  const receiver = createCameraFrameReceiver({
    host: "127.0.0.1",
    port: 0,
    expectedFrames: 2,
    log: (message) => logs.push(message),
  });
  context.after(() => receiver.close());
  const address = await receiver.listen();
  const frame = Buffer.alloc(FRAME_BYTES, 0x33);

  assert.equal((await sendFrame(address.port, frame, 1)).status, 204);
  assert.equal((await sendFrame(address.port, frame, 1)).status, 204);
  assert.equal((await sendFrame(address.port, frame, 2)).status, 204);
  assert.deepEqual(await receiver.done, { receivedFrames: 2, bytes: FRAME_BYTES * 2 });
  assert.equal(
    logs.some((message) => message === "[camera-receiver] retry sequence=1"),
    true,
  );
});

test("camera receiver fails immediately with the missing sequence", async (context) => {
  const receiver = createCameraFrameReceiver({
    host: "127.0.0.1",
    port: 0,
    expectedFrames: 3,
    log: () => {},
  });
  context.after(() => receiver.close());
  const address = await receiver.listen();
  const frame = Buffer.alloc(FRAME_BYTES, 0x66);
  const failure = assert.rejects(receiver.done, /expected=2 received=3/);

  assert.equal((await sendFrame(address.port, frame, 1)).status, 204);
  assert.equal((await sendFrame(address.port, frame, 3)).status, 409);
  await failure;
});

test("camera receiver rejects invalid metadata without counting a frame", async (context) => {
  const receiver = createCameraFrameReceiver({ host: "127.0.0.1", port: 0, expectedFrames: 1 });
  context.after(() => receiver.close());
  const address = await receiver.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/frame`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-willump-width": "640",
      "x-willump-height": "240",
      "x-willump-format": "rgb565",
      "x-willump-run": "1234abcd",
      "x-willump-sequence": "1",
      "x-willump-checksum": "00000000",
    },
    body: Buffer.alloc(FRAME_BYTES),
  });
  assert.equal(response.status, 400);
});

test("camera receiver close destroys a stalled frame upload", async () => {
  const receiver = createCameraFrameReceiver({ host: "127.0.0.1", port: 0, expectedFrames: 1 });
  const address = await receiver.listen();
  const socket = connect(address.port, "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    "POST /frame HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Content-Type: application/octet-stream\r\n" +
      `Content-Length: ${FRAME_BYTES}\r\n` +
      "X-Willump-Width: 320\r\n" +
      "X-Willump-Height: 240\r\n" +
      "X-Willump-Format: rgb565\r\n" +
      "X-Willump-Run: 1234abcd\r\n" +
      "X-Willump-Sequence: 1\r\n" +
      "X-Willump-Checksum: 00000000\r\n\r\n",
  );

  socket.on("error", () => {});
  const socketClosed = new Promise((resolveClosed) => socket.once("close", resolveClosed));
  let timer;
  try {
    await Promise.race([
      Promise.all([receiver.close(), socketClosed]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("receiver close timed out")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
});
