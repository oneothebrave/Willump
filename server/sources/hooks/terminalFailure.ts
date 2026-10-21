import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

// CLI 0.153.4 compatibility adapter. Transcripts are not a stable API.
export function hasTerminalFailure(text: string, turnId: string): boolean {
  return text.split("\n").some((line) => {
    try {
      const record = JSON.parse(line);
      return (
        record.type === "event_msg" &&
        record.payload?.type === "task_complete" &&
        record.payload.turn_id === turnId &&
        typeof record.payload.error?.message === "string" &&
        record.payload.error.message.length > 0
      );
    } catch {
      return false;
    }
  });
}

type Binding = { sessionId: string | null; turnId: string | null };
type AsyncInputCallback = (session: string, turn: string, waiting: boolean) => unknown;

// CLI 0.163.0 emits async question cards as typed AgentMessage metadata and
// replies/steering as UserMessage. Text, reasoning and tool output are ignored.
export function asyncInputSignal(text: string, turnId: string) {
  try {
    const record = JSON.parse(text);
    const payload = record.payload;
    if (
      record.type !== "event_msg" ||
      payload?.type !== "item_completed" ||
      payload.turn_id !== turnId
    ) {
      return;
    }
    const item = payload.item;
    if (typeof item?.id !== "string" || !item.id || item.id.length > 256) {
      return;
    }
    if (item.type === "UserMessage") {
      return { id: item.id, waiting: false };
    }
    if (
      item.type === "AgentMessage" &&
      Array.isArray(item.questions) &&
      item.questions.length > 0
    ) {
      return { id: item.id, waiting: true };
    }
  } catch {
    // Partial/unsupported records do not change an interaction state.
  }
}
type ObserverState = {
  phase: "unbound" | "searching" | "reading" | "missing" | "ambiguous" | "error" | "stopped";
  lastReadAt: number | null;
  error: string | null;
  oversizedRecords: number;
};

/** Incremental byte framing: UTF-8 and JSON records may cross any read boundary. */
export function createTerminalFailureWatcher(
  root: string,
  getBinding: () => Binding,
  reportFailure: (session: string, turn: string) => unknown,
  options: {
    maxRecordBytes?: number;
    bytesPerPoll?: number;
    onAsyncInput?: AsyncInputCallback;
  } = {},
) {
  const maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
  const bytesPerPoll = options.bytesPerPoll ?? 4 * 1024 * 1024;
  let stopped = false;
  let polling = false;
  let bindingKey = "";
  let transcriptPath: string | undefined;
  let offset = 0;
  let fileIdentityKey = "";
  let failureDelivered = false;
  let discardRecord = false;
  let recordBytes = 0;
  let recordParts: Buffer[] = [];
  let asyncWaiting = false;
  const seenInputItems = new Set<string>();
  const state: ObserverState = {
    phase: "unbound",
    lastReadAt: null,
    error: null,
    oversizedRecords: 0,
  };

  function resetReader() {
    offset = 0;
    fileIdentityKey = "";
    recordParts = [];
    recordBytes = 0;
    discardRecord = false;
    failureDelivered = false;
    asyncWaiting = false;
    seenInputItems.clear();
  }

  async function poll() {
    if (polling || stopped) {
      return;
    }
    const { sessionId, turnId } = getBinding();
    if (!sessionId || !turnId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
      bindingKey = "";
      transcriptPath = undefined;
      resetReader();
      state.phase = "unbound";
      return;
    }
    polling = true;
    const isCurrentBinding = () =>
      !stopped && getBinding().sessionId === sessionId && getBinding().turnId === turnId;
    try {
      const nextBindingKey = `${sessionId}:${turnId}`;
      if (bindingKey !== nextBindingKey) {
        bindingKey = nextBindingKey;
        transcriptPath = undefined;
        resetReader();
        state.error = null;
      }
      if (!transcriptPath) {
        state.phase = "searching";
        const files = await readdir(root, { recursive: true });
        if (!isCurrentBinding()) {
          return;
        }
        const matches = files.filter((fileName) => fileName.endsWith(`-${sessionId}.jsonl`));
        if (matches.length !== 1) {
          state.phase = matches.length ? "ambiguous" : "missing";
          return;
        }
        transcriptPath = join(root, matches[0]);
      }
      const file = await open(transcriptPath, "r");
      try {
        const stat = await file.stat();
        const fileIdentity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (fileIdentityKey !== fileIdentity || stat.size < offset) {
          resetReader();
        }
        fileIdentityKey = fileIdentity;
        let bytesReadThisPoll = 0;
        while (offset < stat.size && bytesReadThisPoll < bytesPerPoll && isCurrentBinding()) {
          const buffer = Buffer.alloc(
            Math.min(65536, stat.size - offset, bytesPerPoll - bytesReadThisPoll),
          );
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead || !isCurrentBinding()) {
            break;
          }
          offset += bytesRead;
          bytesReadThisPoll += bytesRead;
          let pieceStart = 0;
          for (let byteIndex = 0; byteIndex <= bytesRead; byteIndex++) {
            if (byteIndex !== bytesRead && buffer[byteIndex] !== 10) {
              continue;
            }
            const piece = buffer.subarray(pieceStart, byteIndex);
            recordBytes += piece.length;
            if (!discardRecord && recordBytes > maxRecordBytes) {
              discardRecord = true;
              recordParts = [];
              state.oversizedRecords++;
              state.error = "record_too_large";
            }
            if (!discardRecord && piece.length) {
              recordParts.push(piece);
            }
            if (byteIndex < bytesRead) {
              const text = !discardRecord ? Buffer.concat(recordParts).toString("utf8") : "";
              const input = options.onAsyncInput ? asyncInputSignal(text, turnId) : undefined;
              if (input && !seenInputItems.has(input.id)) {
                seenInputItems.add(input.id);
                if (seenInputItems.size > 512) {
                  seenInputItems.delete(seenInputItems.values().next().value!);
                }
                asyncWaiting = input.waiting;
              }
              if (!discardRecord && !failureDelivered && hasTerminalFailure(text, turnId)) {
                if (isCurrentBinding()) {
                  reportFailure(sessionId, turnId);
                  failureDelivered = true;
                }
              }
              recordParts = [];
              recordBytes = 0;
              discardRecord = false;
            }
            pieceStart = byteIndex + 1;
          }
        }
        if (isCurrentBinding()) {
          // Commit only the fully caught-up snapshot. Replaying history must
          // not briefly show old questions which already have a reply.
          if (offset >= stat.size && recordBytes === 0) {
            options.onAsyncInput?.(sessionId, turnId, asyncWaiting);
          }
          state.phase = "reading";
          state.lastReadAt = Date.now();
          if (state.error !== "record_too_large") {
            state.error = null;
          }
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isCurrentBinding()) {
        transcriptPath = undefined;
        resetReader();
        state.phase = "error";
        state.error = (error as NodeJS.ErrnoException).code ?? "read_failed";
      }
    } finally {
      polling = false;
    }
  }

  return {
    poll,
    status: () => ({ ...state }),
    stop() {
      stopped = true;
      state.phase = "stopped";
      recordParts = [];
    },
  };
}

export function watchTerminalFailures(
  root: string,
  getBinding: () => Binding,
  reportFailure: (session: string, turn: string) => unknown,
  reportAsyncInput?: AsyncInputCallback,
) {
  const observer = createTerminalFailureWatcher(root, getBinding, reportFailure, {
    onAsyncInput: reportAsyncInput,
  });
  const timer = setInterval(() => void observer.poll(), 250);
  timer.unref();
  return Object.assign(
    () => {
      clearInterval(timer);
      observer.stop();
    },
    { status: observer.status },
  );
}
