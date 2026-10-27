# Willump

**English** · [简体中文](README.zh-CN.md)

Willump turns Codex CLI activity into an animated, physical status companion on an M5StackChan
ESP32-S3. It shows the current agent state, plays approval and completion cues, and raises its head
while the local bridge is connected.

```text
Codex CLI hooks
  → local hook receiver (127.0.0.1:8788)
  → Node.js bridge
  → WebSocket status stream (:8787/status)
      ├→ M5StackChan: face, sound, and head motion
      └→ optional browser simulator
```

The current firmware is `2026.10.26-r1`. The latest reboot and head-motion validation is recorded in
[docs/head-reboot-2026-10-26.md](docs/head-reboot-2026-10-26.md). For machine migration, private
device files, and the latest handoff state, see [HANDOFF.md](HANDOFF.md).

## Features

- Seven visual states: idle, thinking, running, waiting, done, error, and offline.
- A falling gold question-mark animation and one approval cue for a real user wait.
- A one-shot completion chime for each new completed turn; reconnect snapshots stay silent.
- Session and turn isolation, parallel-tool tracking, approval/input recovery, and terminal-error
  detection without forwarding prompt or file contents.
- Connection-driven head motion: preserve the current pose before the first valid hello, raise the
  head immediately when connected, and return to level only after a real disconnect.
- Local diagnostics, explicit session reset, redacted event capture, and long-running stability
  sampling.
- A browser simulator for protocol development; it is not required for daily use.

## Requirements

- Node.js 24 and npm.
- A Codex CLI version with hooks support.
- M5StackChan ESP32-S3 with 16 MB flash and Quad PSRAM.
- A mutually reachable local network; the device uses 2.4 GHz Wi-Fi.
- PlatformIO and esptool only when building, backing up, or flashing firmware.

## Quick start

### 1. Install dependencies and hooks

```sh
git clone https://github.com/oneothebrave/Willump.git
cd Willump
npm ci
npm run hooks:install
```

The installer merges project-local notifications into `.codex/hooks.json` and preserves unrelated
handlers. Start Codex in this repository, open `/hooks`, and review and trust the definitions. A
configuration file on disk does not mean the hooks have been trusted.

To drive Willump while Codex is running in other repositories, use a user-level installation instead:

```sh
npm run hooks:install -- --uninstall
npm run hooks:install -- --global
```

Reinstall hooks after moving this repository or changing the Node.js path. See
[docs/cli-hooks.md](docs/cli-hooks.md) for lifecycle, privacy, and fallback behavior.

### 2. Start the bridge

On any platform:

```sh
npm start
```

On macOS with Homebrew, install the convenience command once:

```sh
ln -s "$PWD/scripts/willump" "$(brew --prefix)/bin/willump"
```

You can then start Willump from any directory:

```sh
willump
```

Keep the terminal open and press `Ctrl+C` to stop a bridge started there. A healthy existing bridge
is reused. Use `willump --reset` or `npm run session:reset` from another terminal to release the
current CLI-session binding without terminating Codex.

### 3. Run Codex normally

In a repository where the hooks are installed and trusted:

```sh
codex
```

No test prompt or browser window is needed. The bridge publishes real CLI lifecycle events to the
device.

### 4. Configure the device

If it does not exist, copy
`firmware/stackchan/include/config.example.h` to
`firmware/stackchan/include/config.local.h`, then configure:

- 2.4 GHz Wi-Fi credentials, or saved-Wi-Fi mode for a device that is already provisioned.
- `BRIDGE_HOST` as the computer's reachable LAN IPv4 address or stable `.local` hostname.
- `BRIDGE_PORT`, which defaults to `8787`.

Do not include `ws://`, the port, or `/status` in `BRIDGE_HOST`; do not use `127.0.0.1` or `0.0.0.0`.
A `.local` hostname avoids reflashing solely because DHCP changed the computer's IPv4 address.

Device configuration, firmware binaries, and full-flash backups may contain network credentials.
They are Git-ignored and must not be committed or uploaded. New hardware also requires manual head
calibration; never reuse another robot's calibration value. Follow
[firmware/stackchan/README.md](firmware/stackchan/README.md) for backup, build, flash, and serial
verification.

## Device states

| Display  | Protocol states                     | Device behavior                                                               |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Idle     | `idle`, `sleepy`, `sleep`           | LED arc eyes and a smile with occasional looking and blinking                 |
| Thinking | `thinking`, `searching`, `speaking` | Horizontal eyes and a pulsing thought frame                                   |
| Running  | `running`, `editing`, `tool`        | Animated Pong paddles and ball                                                |
| Waiting  | `waiting`                           | Gold question mark falls, bounces, and remains; a new real wait plays one cue |
| Done     | `done`                              | Smile with a one-shot left wink; a new completed turn plays one chime         |
| Error    | `error`                             | Red crossed eyes and a short shake                                            |
| Offline  | connection override                 | Gray crossed eyes; the head returns to level after a real disconnect          |

Every state remains visible until a new event arrives. Done does not time out to idle. Reconnecting
restores the latest snapshot without replaying one-shot audio. `Stop` means the response ended; it
does not guarantee task success.

Agent states do not independently move the head. Once the bridge is connected, idle, working,
waiting, done, and error all remain raised. See [docs/head-motion.md](docs/head-motion.md) for the
calibration, retry, and safety boundaries.

## Configuration

| Variable                          | Default   | Purpose                                   |
| --------------------------------- | --------- | ----------------------------------------- |
| `AGENT_INDICATOR_HOST`            | `0.0.0.0` | Status bridge listen address              |
| `AGENT_INDICATOR_PORT`            | `8787`    | WebSocket and bridge health port          |
| `AGENT_INDICATOR_HOOK_PORT`       | `8788`    | Loopback-only hook receiver port          |
| `AGENT_INDICATOR_HOOK_SESSION_ID` | unset     | Optionally pin one CLI session            |
| `AGENT_INDICATOR_DEBUG_EVENTS`    | unset     | Set to `1` for redacted event diagnostics |

The status and hook ports must differ. The hook receiver stays on loopback; expose only the status
port to the trusted LAN used by the robot.

The version-1 device protocol contains only `bridge.hello` and `agent.event`. Event types are defined
in [src/domain/agentStatus.ts](src/domain/agentStatus.ts), and the wire format is defined in
[src/domain/statusProtocol.ts](src/domain/statusProtocol.ts).

## Diagnostics

```sh
npm run doctor
npm run events:capture -- 60
npm run stability -- --minutes 720
```

`doctor` reports bridge and hook health, candidate LAN addresses, session ownership, observer status,
and the latest event. A WebSocket client count can include the browser simulator and does not prove
that the physical device rendered the state.

Automatic CLI-process exit detection is currently Windows-specific. On unsupported systems, use the
health diagnostics and an explicit session reset when a dead CLI remains bound.

## Development

| Command                  | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `npm test`               | Node bridge, hooks, lifecycle, protocol, and script regression tests |
| `npm run build`          | TypeScript checking and Vite production build                        |
| `npm run test:contract`  | Check the consumed Codex app-server schema discriminants             |
| `npm run format`         | Format project-owned TS/JS and browser-preview sources               |
| `npm run dev`            | Run the optional browser simulator                                   |
| `npm run dev:mock`       | Run the bridge with generated mock events                            |
| `npm run dev:app-server` | Run the separate app-server development source                       |

Head-motion native tests and PlatformIO environments are documented in
[firmware/stackchan/test/native/README.md](firmware/stackchan/test/native/README.md) and
[firmware/stackchan/README.md](firmware/stackchan/README.md). Mock, compilation, serial feedback, and
human-observed hardware behavior are separate levels of evidence.

## Repository guide

```text
server/                 Node bridge, event sources, and lifecycle tests
shared/                 Shared hook registry and platform adapters
scripts/                Launch, installation, diagnostics, and capture tools
src/                    Browser simulator and shared protocol definitions
firmware/stackchan/      ESP32 firmware, assets, face rendering, and head control
docs/                   Design, setup, behavior, and validation records
AGENTS.md                Repository-wide development constraints
REVIEW.md                Evidence requirements for code-review findings
HANDOFF.md               Local-device migration and current validation state
```

Review [AGENTS.md](AGENTS.md) before making changes and [REVIEW.md](REVIEW.md) before reporting review
findings. Asset provenance and licenses are recorded in
[firmware/stackchan/assets/README.md](firmware/stackchan/assets/README.md).

Outstanding physical validation includes a completed 12-hour stability run, router/Wi-Fi interruption,
a real rejected approval, and injected servo/mechanical failures. Unit tests and controlled event
replay do not replace those checks.
