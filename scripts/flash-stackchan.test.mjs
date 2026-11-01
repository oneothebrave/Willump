import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, readFirmwareTarget } from "./flash-stackchan.mjs";

const version = '#define INDICATOR_FIRMWARE_VERSION "2026.11.01-r1"';

test("firmware upload requires one stable local bridge target", () => {
  assert.deepEqual(
    readFirmwareTarget(
      'constexpr char BRIDGE_HOST[] = "larrys-mac-mini.local";\nconstexpr uint16_t BRIDGE_PORT = 8787;',
      version,
    ),
    { host: "larrys-mac-mini.local", port: 8787, version: "2026.11.01-r1" },
  );
  assert.throws(() =>
    readFirmwareTarget(
      'constexpr char BRIDGE_HOST[] = "192.168.3.49";\nconstexpr uint16_t BRIDGE_PORT = 8787;',
      version,
    ),
  );
  assert.throws(() =>
    readFirmwareTarget(
      'constexpr char BRIDGE_HOST[] = "host.local";\nconstexpr char BRIDGE_HOST[] = "other.local";\nconstexpr uint16_t BRIDGE_PORT = 8787;',
      version,
    ),
  );
});

test("firmware upload requires an explicit port unless it only checks configuration", () => {
  assert.deepEqual(parseArgs(["--check"]), { check: true, port: undefined });
  assert.deepEqual(parseArgs(["--port", "/dev/cu.usbmodem21401"]), {
    check: false,
    port: "/dev/cu.usbmodem21401",
  });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(["--port"]));
  assert.throws(() => parseArgs(["--unknown"]));
});
