# macOS 环境准备

更新日期：2026-10-15。以下命令在仓库根目录的 macOS 终端执行；本机目录为
`/Users/larry/Documents/Projects/Willump`。历史设备验收与备份摘要见 [HANDOFF.md](../HANDOFF.md)。

## 2026-10-15 执行结果

- 用户已将项目移至 `/Users/larry/Documents/Projects/Willump`；Node.js 24.21.0、npm 11.19.0、
  uv 管理的 Python 3.13.16 和 Codex CLI 0.162.1 已可用。
- npm 依赖及 `.tmp/hardware-venv` 固件工具已安装。
- 准备脚本最初停在测试：本机未配置 `127.0.0.2`，监听时报 `EADDRNOTAVAIL`，与机器人无关。
  已修正 WebSocket 启动错误处理，仅在该可选地址不可用时跳过，并增加显式 `::1` 端到端覆盖。
- 修复后 `npm test` 为 88 项：86 通过、0 失败、2 跳过（不可用的 IPv4 别名和 Windows 专用测试）。
  `npm run build`、`npm run test:contract` 均通过；契约范围仍为两个类型。
- 已生成新目录的项目级 `.codex/hooks.json`，仍需用户在本项目交互式 CLI `/hooks` 审核信任。
  bridge 已恢复运行，bridge 与 hooks 健康检查正常，设备客户端为 1；CLI hooks 接收计数仍为 0，真实 CLI 活动待验收。
- 机器人已连接 `/dev/cu.usbmodem21401`，芯片 ESP32-S3 rev 0.2、16MB Flash；串口实际版本为
  `2026.10.15-r1`、`willump-led-v3`，水平基准 591、自动模式开启、fault=0。
- 烧录前的 `2026.10.13-r1` 完整 Flash 已备份，16MB 大小与 SHA-256 已核对，摘要见 HANDOFF。
  新固件已连 `DuanWu`，设备 IP `192.168.3.44`，已收到 hello version=1 与 `thread.idle` 快照。
- 已从用户提供目录迁入 Wi-Fi 配置及两份旧备份；本地 `BRIDGE_HOST=192.168.3.49`、
  `BRIDGE_PORT=8787`、`USE_SAVED_WIFI=false`，凭据仅保存在被 Git 忽略的本地配置。
- 已从远端合入 `38f867f`，源码更新为 `2026.10.15-r1`、`willump-led-v3`；Mac 适配与依赖修复保留。
  README 与 HANDOFF 的冲突已解决，`main` 已同步 `origin/main`；本地改动保持未提交。
  合并后再次验证：86 项测试通过、0 失败、2 跳过，生产构建、Codex 契约检查通过，
  `status-client` 和 `logic-test` 两个固件环境编译通过。
  本地 Wi-Fi 配置文件已通过 SHA-256 确认与合并前完全一致，Mac 网络设置未改动；
  合并后使用独立设备副本设置 `DuanWu`（密码沿用已确认的原密码）并常规烧录；没有擦除全部 Flash 或改动 NVS 校准。
- npm 安装时的 1 项高危告警已于同日修复：`vite → postcss → source-map-js@1.2.1` 存在
  CVE-2026-93749，处理恶意 source map 可导致拒绝服务；见
  [维护者修复公告](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)。
  已将锁定版本升级至 `1.2.2`，其余依赖版本保留。`npm audit` 报告 0 项漏洞，
  修复后完整测试仍为 86 通过、0 失败、2 跳过，生产构建通过。

## 2026-10-14 准备记录

- Node.js 24 由用户自行下载安装，并使 `node`、`npm` 可在终端运行。
  Python 由用户使用 uv 安装和维护；本机已发现 uv 管理的 3.13.16，脚本可复用已有 3.13，
  无需将 `python3.13` 加入全局 PATH 或修改 shell 配置。
- 本轮借用 ChatGPT 内置 Node.js 24.21.0，已通过本机实际 Codex app-server schema 契约检查。
  这不代表用户终端已安装 Node；契约只覆盖 `TurnStatus`、`ThreadActiveFlag` 两个类型。
- 依赖未安装时，初跑另有 2 个测试文件因缺少 `ws` 失败；随后明确执行的无依赖测试子集为
  8 项通过、0 失败、1 项 Windows 专用测试跳过。全套测试和构建仍待安装依赖后执行。
- 项目级 hooks 尚未安装或审核信任，日常 bridge 尚未启动，真实 CLI 事件尚未验收。
  `doctor` 确认项目及用户级通知定义均未安装，两个监听服务均未运行。
- 本轮按模板新建本地固件配置，`BRIDGE_HOST=192.168.3.49`；Wi-Fi 凭据尚未填写，
  模板的 `USE_SAVED_WIFI=true` 尚未确认可用。迁移的两份 Flash 备份未找到，本轮未烧录设备。
- 准备脚本通过 `bash -n`，文件差异通过 `git diff --check`；准备脚本尚未实际执行。

## 安装完成后：依赖、hooks 和检查

Node 安装完成后，优先执行准备脚本。它要求当前终端能找到 `node`、`npm`、`uv` 和 `codex`，
选择已有 Python 3.13，安装 npm 与固件依赖，完成测试、构建和契约检查后生成项目级 hooks：

```sh
cd /Users/larry/Documents/Projects/Willump
bash scripts/prepare-macos.sh
```

脚本不下载 Node 或 Python，不启动 bridge，也不烧录。任一步失败会停止，先处理对应报错再重跑。
脚本成功后，在本项目运行 `codex`，执行 `/hooks`，审核并信任通知定义。
定义审核与信任规则见 [OpenAI Docs](https://learn.chatgpt.com/docs/hooks)。

### 手动执行

也可以分步安装仓库锁定的依赖并检查：

```sh
cd /Users/larry/Documents/Projects/Willump
node --version
npm --version
uv python find 3.13 --no-python-downloads
codex --version
npm ci
npm test
npm run build
npm run test:contract
npm run hooks:install
codex
```

在该交互式 Codex CLI 内执行 `/hooks`，审核并信任本项目通知定义，然后退出 CLI。
项目已受信任、hooks 功能已启用或 `.codex/hooks.json` 存在，都不能代替定义审核。
本次使用项目级安装；更换 Node 路径或移动仓库后重新生成定义，检查旧路径条目。

`test:contract` 当前使用跨平台 Node 脚本，不需要 PowerShell。
Windows 专用测试在 macOS 上可能跳过，记录实际结果，不沿用旧电脑的通过数量。

## 日常 bridge 和真实事件

### willump 快捷命令

在已安装 Homebrew 的 macOS 上，一次安装：

```sh
cd /Users/larry/Documents/Projects/Willump
ln -s "$PWD/scripts/willump" "$(brew --prefix)/bin/willump"
```

Homebrew 的 `bin` 目录须已在终端 PATH 中。本机链接为 `/opt/homebrew/bin/willump`。
以后在任意目录运行：

```sh
willump
```

脚本会定位项目目录，再执行 `npm start`；保持终端运行，按 `Ctrl+C` 停止。
原有的后台健康检查、已运行实例复用和端口检查均沿用。
也可以运行 `willump --check` 检查状态，或 `willump --reset` 释放会话（等同于 `npm run session:reset`）。
若移动项目目录，需重新建立该软链接。

移除快捷命令：

```sh
rm "$(brew --prefix)/bin/willump"
```

### 使用 npm 启动

终端一保持运行：

```sh
cd /Users/larry/Documents/Projects/Willump
npm start
```

终端二在本项目正常运行 `codex`，终端三执行：

```sh
cd /Users/larry/Documents/Projects/Willump
npm run doctor
```

确认 bridge 和 hooks 接收端正常，来源为 `codex-cli-hooks`。在目标 CLI 输入一次只读提问，
再运行 `doctor` 确认接收计数与最近事件变化。状态端口默认监听 `0.0.0.0:8787`，
hooks 端口仅监听 `127.0.0.1:8788`；端口被旧服务占用时，在原终端停止旧服务。

macOS 不支持自动 CLI 进程退出检测，`cliObserver=unsupported` 是当前实现的预期结果。
意外退出或需要更换绑定会话时执行 `npm run session:reset`，再让目标 CLI 发起新活动。
macOS 也不能可靠识别交互 CLI 与 Desktop/app-server/exec；默认会绑定首个有效活动，
必要时用 `AGENT_INDICATOR_HOOK_SESSION_ID` 固定会话。正常 `SessionEnd` 仍可释放绑定。

## 当前已配网设备的构建与烧录

本次为保留原项目 Wi-Fi 配置，使用被 Git 忽略的独立构建副本。活动索引为
`.tmp/device-provisioning/active.json`，当前副本路径如下：

```sh
export PLATFORMIO_CORE_DIR="$PWD/.tmp/platformio"
DEVICE_PROJECT="$PWD/.tmp/device-provisioning/head-reboot-20261026-r1/stackchan"
.tmp/hardware-venv/bin/python -m platformio run -d "$DEVICE_PROJECT" -e status-client
.tmp/hardware-venv/bin/python -m platformio run -d "$DEVICE_PROJECT" -e status-client -t upload --upload-port /dev/cu.usbmodem21401
```

该副本使用精确 SSID `DuanWu`、bridge `larrys-mac-mini.local:8787`，密码只在本机设备配置与镜像中。
原项目 `firmware/stackchan/include/config.local.h` 仍是原内容，后续重烧录当前设备请使用此副本。
当前副本为 `2026.10.26-r1`，修复重启后姿态及舵机启动恢复，沿用固定主机名、turn 完成音效、问号落地动画及审批音；见 [真机验收](head-reboot-2026-10-26.md)。后续升级源码时，在新的构建副本沿用设备配置后重新构建。
2026-10-25 电脑 DHCP 地址由 `192.168.3.49` 变为 `192.168.3.47`，后台正常但机器仍连接旧 IP。
已改用固定主机名恢复连接；根目录运行 `willump` 的启动脚本正常，详见 [连接修复](bridge-hostname-2026-10-25.md)。
迁移电脑时私下保留设备配置并重建工具缓存，配置和镜像不提交 Git。

## 固件工具与设备接入

准备脚本会创建固件虚拟环境；手动准备时使用以下命令。由 uv 选择已有 Python 3.13，
`--no-python-downloads` 禁止 uv 另行下载 Python：
Python 版本选择说明见 [uv 官方文档](https://docs.astral.sh/uv/concepts/python-versions/)。

```sh
uv --version
STACKCHAN_PYTHON="$(uv python find 3.13 --no-python-downloads)"
uv venv --python "$STACKCHAN_PYTHON" --no-python-downloads .tmp/hardware-venv
uv pip install --python .tmp/hardware-venv/bin/python esptool==5.4.0 platformio==6.2.0 pyserial
export PLATFORMIO_CORE_DIR="$PWD/.tmp/platformio"
.tmp/hardware-venv/bin/python -m platformio run -d firmware/stackchan -e status-client
.tmp/hardware-venv/bin/python -m serial.tools.list_ports -v
```

不要迁移旧 Windows 虚拟环境。PlatformIO 使用项目内 `.tmp/platformio` 缓存；
之后每个执行固件命令的终端都需设置同样的 `PLATFORMIO_CORE_DIR`。
macOS USB 串口通常为 `/dev/cu.usbmodem…` 或 `/dev/cu.usbserial…`，以端口列表为准，不能沿用 COM3。

2026-10-25 实际局域网网卡 `en1` 的 IPv4 为 `192.168.3.47`；网络变化后可再次确认：

```sh
ipconfig getifaddr en1
```

新设备的 `BRIDGE_HOST` 可填写确认后的局域网 IP，或优先使用本机固定的 `.local` 主机名。
使用 `scutil --get LocalHostName` 获取 Mac 主机名，再加 `.local`；本机为 `larrys-mac-mini.local`。
主机名不包含 `ws://`、端口或 `/status`；当前已配网设备按上文使用独立构建副本。
虚拟网卡地址 `198.18.0.1` 不用于机器人连接。
在本地填写 2.4GHz Wi-Fi 凭据；只有确认设备已保存有效配置时才使用 `USE_SAVED_WIFI=true`。
电脑与机器人须可互访，防火墙允许机器人访问 TCP 8787。

主机名、端口或配网配置变化后，需重新构建并烧录 `status-client`；固定主机名不变时，
DHCP 分配的电脑 IP 变化无需重新烧录。接入设备并确认串口后，
将下方示例端口替换为端口列表中的实际值：

```sh
STACKCHAN_PORT=/dev/cu.usbmodemXXXX
export PLATFORMIO_CORE_DIR="$PWD/.tmp/platformio"
.tmp/hardware-venv/bin/python -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port "$STACKCHAN_PORT"
.tmp/hardware-venv/bin/python scripts/read-device.py --port "$STACKCHAN_PORT" --seconds 5 --send v --expect 'firmware version=2026.10.07-r1'
```

迁移原厂和升级前 Flash 备份后，按 HANDOFF 中的大小及 SHA-256 核对。普通迁移无需擦除全部 Flash，
也无需重新校准同一个机器人。配置、备份和固件二进制保留在本地，不提交 Git。

连接后仍需串口或屏幕确认设备收到真实事件；`clients=1` 可能只是浏览器。
联网回放、舵机保护及完整连续采样继续按 HANDOFF 的顺序验收。
