import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const FRAME_BYTES = 320 * 240 * 2;

function checksumFrame(frame) {
  let checksum = 2166136261;
  for (const byte of frame) {
    checksum ^= byte;
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
  return checksum.toString(16).padStart(8, "0");
}

export function createCameraFrameReceiver({
  host = "0.0.0.0",
  port = 8790,
  expectedFrames = 10,
  log = console.log,
} = {}) {
  let receivedFrames = 0;
  let currentRun;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolveDonePromise, rejectDonePromise) => {
    resolveDone = resolveDonePromise;
    rejectDone = rejectDonePromise;
  });
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/frame") {
      response.writeHead(404).end();
      return;
    }

    const sequence = Number(request.headers["x-willump-sequence"]);
    const run = request.headers["x-willump-run"];
    const contentLength = Number(request.headers["content-length"]);
    const validMetadata =
      request.headers["content-type"] === "application/octet-stream" &&
      request.headers["x-willump-width"] === "320" &&
      request.headers["x-willump-height"] === "240" &&
      request.headers["x-willump-format"] === "rgb565" &&
      typeof run === "string" &&
      /^[0-9a-f]{8}$/.test(run) &&
      Number.isInteger(sequence) &&
      sequence > 0 &&
      contentLength === FRAME_BYTES &&
      /^[0-9a-f]{8}$/.test(request.headers["x-willump-checksum"] ?? "");
    if (!validMetadata) {
      request.resume();
      response.writeHead(400).end();
      return;
    }

    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const frame = Buffer.concat(chunks);
      const checksum = checksumFrame(frame);
      if (frame.length !== FRAME_BYTES || checksum !== request.headers["x-willump-checksum"]) {
        response.writeHead(422).end();
        return;
      }

      if (currentRun !== undefined && run !== currentRun) {
        if (sequence !== 1) {
          const error = new Error(
            `camera sequence gap: new run ${run} started at ${sequence}, expected 1`,
          );
          response.once("finish", () => rejectDone(error));
          response.writeHead(409).end();
          return;
        }
        log(`[camera-receiver] new-run discarded=${receivedFrames}`);
        receivedFrames = 0;
      }
      currentRun = run;
      if (sequence === receivedFrames && receivedFrames > 0) {
        log(`[camera-receiver] retry sequence=${sequence}`);
        response.writeHead(204).end();
        return;
      }
      if (sequence !== receivedFrames + 1) {
        const error = new Error(
          `camera sequence gap: run=${run} expected=${receivedFrames + 1} received=${sequence}`,
        );
        response.once("finish", () => rejectDone(error));
        response.writeHead(409).end();
        return;
      }

      receivedFrames++;
      log(
        `[camera-receiver] frame=${receivedFrames}/${expectedFrames} sequence=${sequence} ` +
          `bytes=${frame.length} checksum=${checksum}`,
      );
      if (receivedFrames === expectedFrames) {
        response.once("finish", () => {
          resolveDone({ receivedFrames, bytes: receivedFrames * FRAME_BYTES });
        });
      }
      response.writeHead(204).end();
    });
  });

  return {
    done,
    async listen() {
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
      return server.address();
    },
    async close() {
      if (!server.listening) {
        return;
      }
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
      });
    },
  };
}

function parseInteger(raw, fallback, min, max, name) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: expected integer between ${min} and ${max}, got: ${raw}`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = parseInteger(process.argv[2], 8790, 1, 65535, "port");
  const expectedFrames = parseInteger(process.argv[3], 10, 1, 100, "frames");
  const seconds = parseInteger(process.argv[4], 45, 1, 300, "seconds");

  const receiver = createCameraFrameReceiver({ port, expectedFrames });
  const address = await receiver.listen();
  console.log(
    `[camera-receiver] listening=${address.address}:${address.port} frames=${expectedFrames}`,
  );
  let timer;
  try {
    const summary = await Promise.race([
      receiver.done,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("camera receiver timed out")), seconds * 1000);
      }),
    ]);
    console.log(`[camera-receiver] PASS frames=${summary.receivedFrames} bytes=${summary.bytes}`);
  } finally {
    clearTimeout(timer);
    await receiver.close();
  }
}
