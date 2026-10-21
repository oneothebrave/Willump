import { existsSync } from "node:fs";
import WebSocket from "ws";

type Binding = { sessionId: string | null; turnId: string | null };
type Report = (session: string, turn: string, waiting: boolean | null) => unknown;
type Phase = "unbound" | "connecting" | "reading" | "unavailable" | "error" | "stopped";
type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Read the existing runtime; never resume a thread, create turns, or answer requests. */
export function createInteractionWatcher(
  socketPath: string,
  getBinding: () => Binding,
  report: Report,
  options: { intervalMs?: number; timeoutMs?: number; retryMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 1000;
  const retryMs = options.retryMs ?? 2000;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let socket: WebSocket | undefined;
  let connecting: Promise<void> | undefined;
  let initialized = false;
  let stopped = false;
  let polling = false;
  let retryAt = 0;
  let phase: Phase = "unbound";
  let lastReadAt: number | null = null;
  let error: string | null = null;

  function disconnect() {
    const previous = socket;
    socket = undefined;
    initialized = false;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("runtime_disconnected"));
    }
    pending.clear();
    previous?.terminate();
  }

  function request(method: "initialize" | "thread/read", params: unknown) {
    return new Promise<unknown>((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("runtime_disconnected"));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("runtime_timeout"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function connect() {
    if (initialized) {
      return;
    }
    if (connecting) {
      return connecting;
    }
    connecting = (async () => {
      phase = "connecting";
      const connection = new WebSocket(`ws+unix://${socketPath}:/`, {
        handshakeTimeout: timeoutMs,
        maxPayload: 65536,
      });
      socket = connection;
      connection.on("message", (data) => {
        if (socket !== connection || stopped) {
          return;
        }
        try {
          const message = JSON.parse(data.toString());
          // All notifications and server requests are deliberately ignored.
          if (message.method || !pending.has(message.id)) {
            return;
          }
          const task = pending.get(message.id)!;
          pending.delete(message.id);
          clearTimeout(task.timer);
          if (message.error || !("result" in message)) {
            task.reject(new Error("runtime_rpc_failed"));
          } else {
            task.resolve(message.result);
          }
        } catch {
          // Never log metadata, user text, or unsolicited server payloads.
        }
      });
      connection.on("error", () => {
        if (socket === connection) {
          disconnect();
        }
      });
      connection.on("close", () => {
        if (socket === connection) {
          disconnect();
        }
      });
      await new Promise<void>((resolve, reject) => {
        connection.once("open", resolve);
        connection.once("error", () => reject(new Error("runtime_connect_failed")));
        connection.once("close", () => reject(new Error("runtime_disconnected")));
      });
      await request("initialize", {
        clientInfo: { name: "willump_status_reader", version: "0.1.0" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      if (socket !== connection || stopped) {
        throw new Error("runtime_disconnected");
      }
      connection.send(JSON.stringify({ method: "initialized" }));
      initialized = true;
    })();
    try {
      await connecting;
    } finally {
      connecting = undefined;
    }
  }

  async function poll() {
    if (stopped || polling) {
      return;
    }
    const { sessionId, turnId } = getBinding();
    if (!sessionId || !turnId) {
      phase = "unbound";
      return;
    }
    const isCurrent = () => {
      const binding = getBinding();
      return !stopped && binding.sessionId === sessionId && binding.turnId === turnId;
    };
    if (process.platform === "win32" || !existsSync(socketPath)) {
      phase = "unavailable";
      error = "runtime_socket_unavailable";
      report(sessionId, turnId, null);
      return;
    }
    if (Date.now() < retryAt) {
      return;
    }
    polling = true;
    try {
      await connect();
      const result = (await request("thread/read", {
        threadId: sessionId,
        includeTurns: false,
      })) as { thread?: { id?: string; status?: { type?: string; activeFlags?: unknown } } };
      if (!isCurrent()) {
        return;
      }
      const thread = result?.thread;
      const status = thread?.status;
      if (
        thread?.id !== sessionId ||
        !status ||
        !["active", "idle"].includes(status.type ?? "") ||
        (status.type === "active" && !Array.isArray(status.activeFlags))
      ) {
        phase = "unavailable";
        error = "runtime_thread_unavailable";
        report(sessionId, turnId, null);
        return;
      }
      const flags = status.type === "active" ? (status.activeFlags as unknown[]) : [];
      report(
        sessionId,
        turnId,
        flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput"),
      );
      phase = "reading";
      error = null;
      lastReadAt = Date.now();
    } catch (failure) {
      disconnect();
      retryAt = Date.now() + retryMs;
      if (isCurrent()) {
        phase = "error";
        error = failure instanceof Error ? failure.message : "runtime_read_failed";
        report(sessionId, turnId, null);
      }
    } finally {
      polling = false;
    }
  }

  const timer = setInterval(() => void poll(), options.intervalMs ?? 250);
  timer.unref();
  return {
    poll,
    status: () => ({ phase, lastReadAt, error }),
    stop() {
      stopped = true;
      clearInterval(timer);
      disconnect();
      phase = "stopped";
    },
  };
}
