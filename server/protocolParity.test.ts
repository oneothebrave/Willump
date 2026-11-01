import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentEventTypes, mapEventToState } from "../src/domain/agentStatus";
import {
  DEVICE_COMMAND_ACTION_POWEROFF,
  DEVICE_COMMAND_ACK_KIND,
  DEVICE_COMMAND_KIND,
  DEVICE_HELLO_KIND,
  MAX_DEVICE_COMMAND_ID_BYTES,
  STATUS_PROTOCOL_VERSION,
  isDeviceCommandAckMessage,
  isDeviceCommandMessage,
  isDeviceHelloMessage,
  isStatusMessage,
} from "../src/domain/statusProtocol";

test("firmware implements all and only the shared AgentEvent mappings", () => {
  const header = readFileSync(
    new URL("../firmware/stackchan/include/event_states.h", import.meta.url),
    "utf8",
  );
  const rows = [...header.matchAll(/\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*0x[0-9a-f]+\s*\}/g)].map(
    (match) => [match[1], match[2]],
  );
  assert.equal(rows.length, agentEventTypes.length);
  assert.deepEqual(rows.map((row) => row[0]).sort(), [...agentEventTypes].sort());
  for (const type of agentEventTypes) {
    assert.equal(
      rows.find((row) => row[0] === type)?.[1],
      mapEventToState({ id: "parity", at: 0, origin: "mock", type }, "idle"),
    );
  }
});

test("default firmware build selects the production status client", () => {
  const ini = readFileSync(
    new URL("../firmware/stackchan/platformio.ini", import.meta.url),
    "utf8",
  );
  assert.match(ini, /\[platformio\]\s+default_envs\s*=\s*status-client\s/);
});

test("firmware control constants match the shared protocol", () => {
  const header = readFileSync(
    new URL("../firmware/stackchan/include/control_protocol.h", import.meta.url),
    "utf8",
  );
  assert.match(header, new RegExp(`VERSION = ${STATUS_PROTOCOL_VERSION};`));
  assert.match(
    header,
    new RegExp(`MAX_COMMAND_ID_BYTES = ${MAX_DEVICE_COMMAND_ID_BYTES};`),
  );
  assert.match(header, new RegExp(`HELLO_KIND = "${DEVICE_HELLO_KIND}";`));
  assert.match(header, new RegExp(`COMMAND_KIND = "${DEVICE_COMMAND_KIND}";`));
  assert.match(header, new RegExp(`ACK_KIND = "${DEVICE_COMMAND_ACK_KIND}";`));
  assert.match(header, new RegExp(`ACTION_POWEROFF = "${DEVICE_COMMAND_ACTION_POWEROFF}";`));
});

test("device messages require the exact version, action, and bounded id", () => {
  const id = "x".repeat(MAX_DEVICE_COMMAND_ID_BYTES);
  const oversizedId = "x".repeat(MAX_DEVICE_COMMAND_ID_BYTES + 1);
  const hello = { kind: DEVICE_HELLO_KIND, version: STATUS_PROTOCOL_VERSION };
  const command = {
    kind: DEVICE_COMMAND_KIND,
    version: STATUS_PROTOCOL_VERSION,
    id,
    action: DEVICE_COMMAND_ACTION_POWEROFF,
  };
  const ack = {
    kind: DEVICE_COMMAND_ACK_KIND,
    version: STATUS_PROTOCOL_VERSION,
    id,
    action: DEVICE_COMMAND_ACTION_POWEROFF,
  };

  assert.equal(isDeviceHelloMessage(hello), true);
  assert.equal(isDeviceCommandMessage(command), true);
  assert.equal(isDeviceCommandAckMessage(ack), true);
  assert.equal(isStatusMessage(hello), true);
  assert.equal(isStatusMessage(command), true);
  assert.equal(isStatusMessage(ack), true);

  assert.equal(isDeviceHelloMessage({ ...hello, version: 2 }), false);
  assert.equal(isDeviceCommandMessage({ ...command, version: 2 }), false);
  assert.equal(isDeviceCommandMessage({ ...command, action: "reboot" }), false);
  assert.equal(isDeviceCommandMessage({ ...command, id: "" }), false);
  assert.equal(isDeviceCommandMessage({ ...command, id: oversizedId }), false);
  assert.equal(isDeviceCommandAckMessage({ ...ack, action: "reboot" }), false);
  assert.equal(isDeviceCommandAckMessage({ ...ack, id: oversizedId }), false);
});
