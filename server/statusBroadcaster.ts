import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  AGENT_EVENT_KIND,
  POWER_OFF_CONTROL_HEADER,
  POWER_OFF_CONTROL_PATH,
  POWER_OFF_CONTROL_VALUE,
  createBridgeHelloMessage,
  createDeviceCommandMessage,
  isDeviceCommandAckMessage,
  isDeviceHelloMessage,
  type AgentEventMessage,
  type StatusMessage,
} from "../src/domain/statusProtocol";

export type BridgeServerConfig = {
  host: string;
  port: number;
  statusPath: string;
  bridgeSource: string;
  sourceIntervalMs?: number;
  heartbeatMs?: number;
  powerOffAckTimeoutMs?: number;
};

export type PowerOffResult = {
  target: number;
  acknowledged: number;
  timedOut: number;
};

export type BridgeServer = {
  broadcast: (message: StatusMessage) => void;
  close: (onClosed?: () => void) => void;
  getClientCount: () => number;
  listen: (onListening?: () => void) => void;
  requestPowerOff: () => Promise<PowerOffResult>;
  waitForClient: () => Promise<void>;
};

type PendingAck = {
  client: WebSocket;
  resolve: (acknowledged: boolean) => void;
};

export function createBridgeServer(config: BridgeServerConfig): BridgeServer {
  const clients = new Set<WebSocket>();
  const firmwareClients = new Set<WebSocket>();
  const clientWaiters = new Set<() => void>();
  const pendingAcks = new Map<string, PendingAck>();
  let latestAgentEventMessage: AgentEventMessage | undefined;
  const server = createHealthServer(
    config,
    clients,
    firmwareClients,
    () => latestAgentEventMessage,
    () => requestPowerOff(),
  );
  const wss = new WebSocketServer({ server, path: config.statusPath });
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!alive.get(client)) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, config.heartbeatMs ?? 30000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (client) => {
    alive.set(client, true);
    client.on("pong", () => alive.set(client, true));
    client.on("error", () => client.terminate());
    clients.add(client);
    resolveClientWaiters(clientWaiters);
    send(
      client,
      createBridgeHelloMessage({
        source: config.bridgeSource,
        intervalMs: config.sourceIntervalMs,
      }),
    );
    if (latestAgentEventMessage) {
      send(client, latestAgentEventMessage);
    }

    client.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (isDeviceHelloMessage(message)) {
        firmwareClients.add(client);
        console.log(`[bridge] firmware registered devices=${firmwareClients.size}`);
        return;
      }

      if (!isDeviceCommandAckMessage(message)) {
        return;
      }

      const pending = pendingAcks.get(message.id);
      if (!pending || pending.client !== client) {
        return;
      }

      pendingAcks.delete(message.id);
      pending.resolve(true);
    });

    client.on("close", () => {
      clients.delete(client);
      firmwareClients.delete(client);
      for (const [id, pending] of pendingAcks) {
        if (pending.client !== client) {
          continue;
        }
        pendingAcks.delete(id);
        pending.resolve(false);
      }
    });
  });

  async function requestPowerOff(): Promise<PowerOffResult> {
    const targets = [...firmwareClients].filter((client) => client.readyState === WebSocket.OPEN);
    if (!targets.length) {
      return { target: 0, acknowledged: 0, timedOut: 0 };
    }

    const commands = targets.map((client) => {
      const id = randomUUID();
      const promise = new Promise<boolean>((resolve) => {
        pendingAcks.set(id, { client, resolve });
        client.send(JSON.stringify(createDeviceCommandMessage({ id })), (error) => {
          if (!error) {
            return;
          }
          const pending = pendingAcks.get(id);
          if (!pending) {
            return;
          }
          pendingAcks.delete(id);
          pending.resolve(false);
        });
      });
      return { id, promise };
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      const timeoutTimer = setTimeout(resolve, config.powerOffAckTimeoutMs ?? 1500);
      timeoutTimer.unref();
      timer = timeoutTimer;
    });
    await Promise.race([Promise.all(commands.map((command) => command.promise)), timeout]);
    if (timer) {
      clearTimeout(timer);
    }

    for (const command of commands) {
      const pending = pendingAcks.get(command.id);
      if (!pending) {
        continue;
      }
      pendingAcks.delete(command.id);
      pending.resolve(false);
    }

    const results = await Promise.all(commands.map((command) => command.promise));
    const acknowledged = results.filter(Boolean).length;

    return {
      target: targets.length,
      acknowledged,
      timedOut: targets.length - acknowledged,
    };
  }

  return {
    broadcast(message) {
      if (message.kind === AGENT_EVENT_KIND) {
        latestAgentEventMessage = message;
      }

      const encoded = JSON.stringify(message);

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(encoded);
        }
      }
    },
    close(onClosed) {
      clearInterval(heartbeat);
      // A peer with a broken network must not hold shutdown indefinitely.
      const forceClose = setTimeout(() => {
        for (const client of clients) {
          client.terminate();
        }
        server.closeAllConnections();
      }, 2000);
      forceClose.unref();
      for (const client of clients) {
        client.close(1001, "bridge shutting down");
      }

      wss.close(() => {
        server.close(() => {
          clearTimeout(forceClose);
          onClosed?.();
        });
      });
    },
    getClientCount() {
      return clients.size;
    },
    requestPowerOff,
    waitForClient() {
      if (clients.size > 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        clientWaiters.add(resolve);
      });
    },
    listen(onListening) {
      server.listen(config.port, config.host, () => {
        console.log(
          `[bridge] status stream ws://${config.host}:${config.port}${config.statusPath}`,
        );
        console.log(`[bridge] health check http://${config.host}:${config.port}/health`);
        onListening?.();
      });
    },
  };
}

function createHealthServer(
  config: BridgeServerConfig,
  clients: Set<WebSocket>,
  firmwareClients: Set<WebSocket>,
  getLatestAgentEventMessage: () => AgentEventMessage | undefined,
  requestPowerOff: () => Promise<PowerOffResult>,
): Server {
  return createServer((request, response) => {
    if (request.url === POWER_OFF_CONTROL_PATH) {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(response, 403, { ok: false, error: "loopback_required" });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (
        request.headers.origin !== undefined ||
        request.headers[POWER_OFF_CONTROL_HEADER] !== POWER_OFF_CONTROL_VALUE
      ) {
        sendJson(response, 403, { ok: false, error: "control_header_required" });
        return;
      }

      void requestPowerOff()
        .then((result) => {
          const complete = result.target > 0 && result.acknowledged === result.target;
          const status = result.target === 0 ? 503 : complete ? 200 : 504;
          sendJson(response, status, {
            ok: complete,
            target: result.target,
            acknowledged: result.acknowledged,
            timedOut: result.timedOut,
            error:
              result.target === 0
                ? "no_registered_devices"
                : complete
                  ? undefined
                  : "incomplete_acknowledgements",
          });
        })
        .catch(() => {
          sendJson(response, 500, { ok: false, error: "control_failed" });
        });
      return;
    }

    if (request.url === "/health") {
      const latestAgentEventMessage = getLatestAgentEventMessage();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          service: "agent-indicator-bridge",
          source: config.bridgeSource,
          clients: clients.size,
          devices: firmwareClients.size,
          uptimeSeconds: Math.floor(process.uptime()),
          memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
          latestAgentEvent: latestAgentEventMessage?.event,
        }),
      );
      return;
    }

    sendJson(response, 404, { ok: false, error: "not_found" });
  });
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  if (address.startsWith("::ffff:")) {
    return isLoopbackAddress(address.slice("::ffff:".length));
  }
  return address === "::1" || address.startsWith("127.");
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function send(client: WebSocket, message: StatusMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function resolveClientWaiters(clientWaiters: Set<() => void>) {
  for (const resolve of clientWaiters) {
    resolve();
  }

  clientWaiters.clear();
}
