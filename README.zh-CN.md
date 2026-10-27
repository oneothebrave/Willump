# Willump

[English](README.md) · **简体中文**

Willump 将 Codex CLI 的工作状态变成 M5StackChan ESP32-S3 上的动画实体助手。它会显示当前
Agent 状态、播放审批与完成提示音，并在本地 bridge 连接后抬头。

```text
Codex CLI hooks
  → 本地 hook 接收端（127.0.0.1:8788）
  → Node.js bridge
  → WebSocket 状态流（:8787/status）
      ├→ M5StackChan：表情、声音和头部动作
      └→ 可选的浏览器模拟器
```

当前固件为 `2026.10.26-r1`。最新重启与头部动作验收见
[docs/head-reboot-2026-10-26.md](docs/head-reboot-2026-10-26.md)。换电脑、本地设备文件和当前接力状态见
[HANDOFF.md](HANDOFF.md)。

## 功能

- 七种视觉状态：空闲、思考、执行、等待、完成、异常和离线。
- 真正等待用户审批或输入时，播放金色问号落地动画和一次审批提示音。
- 每个新完成的 turn 播放一次完成音；重连恢复快照时不会补响。
- 支持会话与 turn 隔离、并行工具、审批/输入恢复和终止错误识别，不向硬件发送提示词或文件内容。
- 头部跟随连接状态：第一次有效 hello 前保持当前姿态，连接后立即抬头，真实断线后才回平。
- 提供本地诊断、显式会话释放、脱敏事件采集和长时间稳定性采样。
- 提供协议开发用的浏览器模拟器；日常使用不需要打开浏览器。

## 环境要求

- Node.js 24 和 npm。
- 支持 hooks 的 Codex CLI。
- 16 MB Flash、Quad PSRAM 的 M5StackChan ESP32-S3。
- 电脑与机器人位于可互访的局域网；机器人使用 2.4 GHz Wi-Fi。
- 仅在构建、备份或烧录固件时需要 PlatformIO 和 esptool。

## 快速开始

### 1. 安装依赖和 hooks

```sh
git clone https://github.com/oneothebrave/Willump.git
cd Willump
npm ci
npm run hooks:install
```

安装器会把项目级通知合并到 `.codex/hooks.json`，保留其他处理器。在本项目启动 Codex，打开
`/hooks`，审核并信任这些定义。配置文件存在不代表 hooks 已被信任。

如果希望在其他仓库中使用 Codex 时也驱动 Willump，改用用户级安装：

```sh
npm run hooks:install -- --uninstall
npm run hooks:install -- --global
```

移动本仓库或更换 Node.js 路径后，需要重新安装 hooks。生命周期、隐私和降级行为见
[docs/cli-hooks.md](docs/cli-hooks.md)。

### 2. 启动 bridge

所有平台都可以运行：

```sh
npm start
```

在装有 Homebrew 的 macOS 上，可以一次性安装快捷命令：

```sh
ln -s "$PWD/scripts/willump" "$(brew --prefix)/bin/willump"
```

之后可以从任意目录启动：

```sh
willump
```

保持终端运行；按 `Ctrl+C` 停止由该终端启动的 bridge。若已有健康实例，启动器会直接复用。
需要释放当前 CLI 会话绑定时，在另一终端运行 `willump --reset` 或
`npm run session:reset`，不会终止 Codex。

### 3. 正常运行 Codex

进入已经安装并信任 hooks 的仓库：

```sh
codex
```

不需要测试 prompt 或浏览器窗口。bridge 会把真实 CLI 生命周期事件发布给机器人。

### 4. 配置机器人

如果文件不存在，将 `firmware/stackchan/include/config.example.h` 复制为
`firmware/stackchan/include/config.local.h`，然后配置：

- 2.4 GHz Wi-Fi 凭据；已配网设备也可以使用保存的 Wi-Fi。
- 将 `BRIDGE_HOST` 设为电脑可访问的局域网 IPv4 或稳定的 `.local` 主机名。
- `BRIDGE_PORT`，默认值为 `8787`。

`BRIDGE_HOST` 不包含 `ws://`、端口或 `/status`，也不能使用 `127.0.0.1` 或 `0.0.0.0`。
使用 `.local` 主机名可以避免电脑 DHCP 地址变化后仅为更新 IP 再次烧录。

设备配置、固件镜像和完整 Flash 备份可能包含网络凭据，已被 Git 忽略，不得提交或上传。
新硬件还需要人工校准头部，不能复用另一台机器的校准值。备份、构建、烧录和串口验证见
[firmware/stackchan/README.md](firmware/stackchan/README.md)。

## 设备状态

| 表现 | 协议状态                            | 设备行为                                             |
| ---- | ----------------------------------- | ---------------------------------------------------- |
| 空闲 | `idle`、`sleepy`、`sleep`           | LED 弧形眼和笑脸，偶尔侧看与眨眼                     |
| 思考 | `thinking`、`searching`、`speaking` | 横向眼睛和脉动的思考框                               |
| 执行 | `running`、`editing`、`tool`        | Pong 球拍和小球动画                                  |
| 等待 | `waiting`                           | 金色问号落下、回弹后保持；新的真实等待播放一次提示音 |
| 完成 | `done`                              | 笑脸和一次左眼眨眼；新的 turn 完成时播放一次完成音   |
| 异常 | `error`                             | 红色叉眼并短暂摇动                                   |
| 离线 | 连接覆盖状态                        | 灰色叉眼；真实断线后头部回平                         |

每个状态都会保持到新事件到达，done 不会按时间自动变回 idle。重连会恢复最近快照，但不会重播
一次性声音。`Stop` 只表示响应结束，不保证任务成功。

Agent 状态本身不单独控制头部。bridge 连接期间，空闲、工作、等待、完成和异常状态都保持抬头。
校准、重试和安全边界见 [docs/head-motion.md](docs/head-motion.md)。

## 配置

| 变量                              | 默认值    | 用途                             |
| --------------------------------- | --------- | -------------------------------- |
| `AGENT_INDICATOR_HOST`            | `0.0.0.0` | 状态 bridge 监听地址             |
| `AGENT_INDICATOR_PORT`            | `8787`    | WebSocket 和 bridge 健康检查端口 |
| `AGENT_INDICATOR_HOOK_PORT`       | `8788`    | 仅回环监听的 hooks 接收端口      |
| `AGENT_INDICATOR_HOOK_SESSION_ID` | 未设置    | 可选，固定一个 CLI 会话          |
| `AGENT_INDICATOR_DEBUG_EVENTS`    | 未设置    | 设为 `1` 输出脱敏事件诊断        |

状态端口和 hooks 端口必须不同。hooks 接收端保持回环监听；只向机器人所在的可信局域网开放状态端口。

版本 1 的设备协议只有 `bridge.hello` 和 `agent.event`。事件类型定义在
[src/domain/agentStatus.ts](src/domain/agentStatus.ts)，传输格式定义在
[src/domain/statusProtocol.ts](src/domain/statusProtocol.ts)。

## 诊断

```sh
npm run doctor
npm run events:capture -- 60
npm run stability -- --minutes 720
```

`doctor` 会显示 bridge 与 hooks 健康状态、候选局域网地址、会话所有权、观察器状态和最近事件。
WebSocket 客户端数量可能包含浏览器模拟器，不能据此证明真机已经显示对应状态。

CLI 进程退出的自动检测目前只完整支持 Windows。其他系统若残留已退出 CLI 的绑定，应结合健康诊断
并显式释放会话。

## 开发与验证

| 命令                     | 用途                                             |
| ------------------------ | ------------------------------------------------ |
| `npm test`               | Node bridge、hooks、生命周期、协议和脚本回归测试 |
| `npm run build`          | TypeScript 检查与 Vite 生产构建                  |
| `npm run test:contract`  | 检查项目消费的 Codex app-server schema 判别值    |
| `npm run format`         | 格式化项目自有 TS/JS 和浏览器预览源码            |
| `npm run dev`            | 启动可选的浏览器模拟器                           |
| `npm run dev:mock`       | 使用自动 mock 事件启动 bridge                    |
| `npm run dev:app-server` | 启动独立的 app-server 开发来源                   |

头部本机测试和 PlatformIO 环境见
[firmware/stackchan/test/native/README.md](firmware/stackchan/test/native/README.md) 与
[firmware/stackchan/README.md](firmware/stackchan/README.md)。mock、编译、串口反馈和人工观察的真机行为
是不同层级的证据，不能相互替代。

## 仓库目录

```text
server/                 Node bridge、事件来源和生命周期测试
shared/                 hooks 注册表和平台适配器
scripts/                启动、安装、诊断和采集工具
src/                    浏览器模拟器和共享协议定义
firmware/stackchan/      ESP32 固件、资源、表情渲染和头部控制
docs/                   设计、安装、行为和验收记录
AGENTS.md                项目级开发约束
REVIEW.md                代码审查 finding 的证据要求
HANDOFF.md               本地设备迁移和当前验收状态
```

修改代码前阅读 [AGENTS.md](AGENTS.md)，报告审查 finding 前阅读 [REVIEW.md](REVIEW.md)。资源来源与
许可证见 [firmware/stackchan/assets/README.md](firmware/stackchan/assets/README.md)。

仍待完成的真机验收包括完整 12 小时稳定性测试、路由器/Wi-Fi 中断、真实审批拒绝，以及舵机或机械
故障注入。单元测试和受控事件回放不能替代这些测试。
