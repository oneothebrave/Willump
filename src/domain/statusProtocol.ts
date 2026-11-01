import { isAgentEventOrigin, isAgentEventType, type AgentEvent } from "./agentStatus";

export const STATUS_PROTOCOL_VERSION = 1;
export const BRIDGE_HELLO_KIND = "bridge.hello";
export const AGENT_EVENT_KIND = "agent.event";
export const DEVICE_HELLO_KIND = "device.hello";
export const DEVICE_COMMAND_KIND = "device.command";
export const DEVICE_COMMAND_ACK_KIND = "device.command.ack";
export const DEVICE_COMMAND_ACTION_POWEROFF = "poweroff";
export const MAX_DEVICE_COMMAND_ID_BYTES = 64;
export const POWER_OFF_CONTROL_PATH = "/control/poweroff";
export const POWER_OFF_CONTROL_HEADER = "x-willump-control";
export const POWER_OFF_CONTROL_VALUE = "poweroff";

const utf8Encoder = new TextEncoder();

export type AgentEventInput = Omit<AgentEvent, "at"> & Partial<Pick<AgentEvent, "at">>;

export type BridgeHelloInput = {
  source: string;
  at?: number;
  intervalMs?: number;
};

export type BridgeHelloMessage = {
  kind: typeof BRIDGE_HELLO_KIND;
  source: string;
  version: typeof STATUS_PROTOCOL_VERSION;
  at: number;
  intervalMs?: number;
};

export type AgentEventMessage = {
  kind: typeof AGENT_EVENT_KIND;
  event: AgentEvent;
};

export type DeviceHelloMessage = {
  kind: typeof DEVICE_HELLO_KIND;
  version: typeof STATUS_PROTOCOL_VERSION;
};

export type DeviceCommandMessage = {
  kind: typeof DEVICE_COMMAND_KIND;
  version: typeof STATUS_PROTOCOL_VERSION;
  id: string;
  action: typeof DEVICE_COMMAND_ACTION_POWEROFF;
};

export type DeviceCommandAckMessage = {
  kind: typeof DEVICE_COMMAND_ACK_KIND;
  version: typeof STATUS_PROTOCOL_VERSION;
  id: string;
  action: typeof DEVICE_COMMAND_ACTION_POWEROFF;
};

export type StatusMessage =
  | BridgeHelloMessage
  | AgentEventMessage
  | DeviceHelloMessage
  | DeviceCommandMessage
  | DeviceCommandAckMessage;

export function createBridgeHelloMessage(input: BridgeHelloInput): BridgeHelloMessage {
  return {
    kind: BRIDGE_HELLO_KIND,
    source: input.source,
    version: STATUS_PROTOCOL_VERSION,
    at: input.at ?? Date.now(),
    intervalMs: input.intervalMs,
  };
}

export function normalizeAgentEvent(input: AgentEventInput): AgentEvent {
  return {
    id: input.id,
    type: input.type,
    at: input.at ?? Date.now(),
    origin: input.origin,
    label: input.label,
    detail: input.detail,
  };
}

export function createAgentEventMessage(event: AgentEvent): AgentEventMessage {
  return {
    kind: AGENT_EVENT_KIND,
    event,
  };
}

export function createDeviceHelloMessage(): DeviceHelloMessage {
  return {
    kind: DEVICE_HELLO_KIND,
    version: STATUS_PROTOCOL_VERSION,
  };
}

export function createDeviceCommandMessage(input: { id: string }): DeviceCommandMessage {
  return {
    kind: DEVICE_COMMAND_KIND,
    version: STATUS_PROTOCOL_VERSION,
    id: input.id,
    action: DEVICE_COMMAND_ACTION_POWEROFF,
  };
}

export function createDeviceCommandAckMessage(input: { id: string }): DeviceCommandAckMessage {
  return {
    kind: DEVICE_COMMAND_ACK_KIND,
    version: STATUS_PROTOCOL_VERSION,
    id: input.id,
    action: DEVICE_COMMAND_ACTION_POWEROFF,
  };
}

export function isStatusMessage(value: unknown): value is StatusMessage {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === BRIDGE_HELLO_KIND) {
    return (
      typeof value.source === "string" &&
      value.version === STATUS_PROTOCOL_VERSION &&
      typeof value.at === "number" &&
      (value.intervalMs === undefined || typeof value.intervalMs === "number")
    );
  }

  if (value.kind === AGENT_EVENT_KIND) {
    return isAgentEvent(value.event);
  }

  if (value.kind === DEVICE_HELLO_KIND) {
    return isDeviceHelloMessage(value);
  }

  if (value.kind === DEVICE_COMMAND_KIND) {
    return isDeviceCommandMessage(value);
  }

  if (value.kind === DEVICE_COMMAND_ACK_KIND) {
    return isDeviceCommandAckMessage(value);
  }

  return false;
}

export function isDeviceHelloMessage(value: unknown): value is DeviceHelloMessage {
  return (
    isRecord(value) &&
    value.kind === DEVICE_HELLO_KIND &&
    value.version === STATUS_PROTOCOL_VERSION
  );
}

export function isDeviceCommandMessage(value: unknown): value is DeviceCommandMessage {
  return (
    isRecord(value) &&
    value.kind === DEVICE_COMMAND_KIND &&
    value.version === STATUS_PROTOCOL_VERSION &&
    value.action === DEVICE_COMMAND_ACTION_POWEROFF &&
    isDeviceCommandId(value.id)
  );
}

export function isDeviceCommandAckMessage(value: unknown): value is DeviceCommandAckMessage {
  return (
    isRecord(value) &&
    value.kind === DEVICE_COMMAND_ACK_KIND &&
    value.version === STATUS_PROTOCOL_VERSION &&
    value.action === DEVICE_COMMAND_ACTION_POWEROFF &&
    isDeviceCommandId(value.id)
  );
}

function isDeviceCommandId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    utf8Encoder.encode(value).length <= MAX_DEVICE_COMMAND_ID_BYTES
  );
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.at !== "number" ||
    !isAgentEventOrigin(value.origin) ||
    !isAgentEventType(value.type)
  ) {
    return false;
  }

  return isOptionalString(value.label) && isOptionalString(value.detail);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
