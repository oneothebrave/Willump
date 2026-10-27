# StackChan 固件

目标设备 M5StackChan ESP32-S3，320×240 横屏、16MB Flash、Quad PSRAM。
当前源码及设备固件为 `2026.10.26-r1`，默认环境为 status-client。
启动和读取重试不再切断舵机 VM，开机未连接时不主动回平，合法连接立即优先抬头。
两种关机姿态和工作状态的真机验收见 [重启修复记录](../../docs/head-reboot-2026-10-26.md)。
当前 Mac 使用固定 `.local` 主机名连接，修复 DHCP 地址变化后机器找不到后台的问题，见 [连接记录](../../docs/bridge-hostname-2026-10-25.md)。
后台协议连接成功后抬头，后台关闭或断线后回水平；加入有限启动恢复与失败后的串口诊断。
沿用 turn 完成时的 iOS 确认“叮咚”、《英雄联盟》问号动画与审批音。
491 条本机逻辑断言及 77 条头部驱动模拟检查全部通过。此前后台连接、关闭、重连的实际运动验证见 [历史记录](../../docs/head-connection-2026-10-20.md)。
USB 用于烧录/串口，日常状态通过 Wi-Fi WebSocket 获取；电脑端运行 `npm start` 和普通 Codex CLI。
音效更新历史见 [Turn 完成音效](../../docs/completion-audio.md)，此前问号更新见 [问号动画](../../docs/permission-question-animation.md)与[审批提示音](../../docs/approval-audio.md)。
换电脑的配置、工具恢复和备份信息见 [HANDOFF.md](../../HANDOFF.md)。

## 正式行为

威朗普 willump-led-v3，联网六态加离线叉眼笑脸。点击切换表情页和调试页。
网络在独立 core 0 任务中运行，UI 不等待同步 TCP 重连；快照通过单槽覆盖队列传递。

| 状态 | 表现 |
| --- | --- |
| idle | 青蓝弧眼、方块笑嘴，偶尔侧看和眨眼，联网时保持抬头 |
| thinking | 短横眼、矩形嘴空心/实心开合，联网时保持抬头 20° |
| running | 两侧竖板上下移动，小球触板后反向 |
| waiting | 金色问号下落、触地回弹与波纹，1.35 秒后保持最后一帧；新审批播放一次现有问号音效 |
| done | 招牌笑眼、宽笑嘴，左眼眨一次；新 turn 完成播放一次 iOS 确认“叮咚”，联网时保持抬头，表情保持到新事件 |
| error | 红底尖括号眼、短横嘴，轻摇一次，联网时保持抬头 |
| offline | 青蓝叉眼和弧形笑嘴，固定显示，头部回平 |

editing/tool 使用执行造型，searching/speaking 使用思考，sleepy/sleep 使用空闲。
不进入芯片深睡眠。扬声器播放审批与 turn 完成提示音，麦克风保持关闭。
几何和调色板见 [设计规范](../../docs/design/expression-design.md)。

所有 Agent 状态按最近接受的事件展示，没有完成计时或静默超时。
调试页大字与 Last 使用同一真实状态，断线时展示 offline。
最近 32 个完成 ID 去重；重复完成不会覆盖后续状态。
重连首个完成快照仍展示 done，不会替换为 idle；新实时完成可重置左眼庆祝。

头部策略只控制 ID 2，水平基准本机为 591、联网时为 655（约 20°）。
收到合法 hello 后立即请求抬头；开机未收到第一次 hello 时保持当前姿态。
已有合法连接后，后台关闭或断线稳定 350ms 才回平；移动时长 900ms。
空闲、等待、完成等事件不再控制头部。无有效校准不运动。
限位、最多 3 次故障重试和串口命令见 [头部说明](../../docs/head-motion.md)。

## 配置与协议

仅消费版本 1 的 bridge.hello 与 agent.event；13 个事件和 TypeScript 映射一致。
连接 `ws://<电脑局域网IP或.local主机名>:8787/status`，不能填写 127.0.0.1 或 0.0.0.0。
本机已配网设备的 `BRIDGE_HOST` 为 `larrys-mac-mini.local`。当前 ESP32-S3 网络库已启用 mDNS 查询，
WebSocket 重连时通过主机名解析地址；电脑与机器人需处于允许 mDNS 的同一局域网。
启动串口日志会打印目标主机名和端口，便于核对实际烧录的配置。
Wi-Fi 每 15 秒重试，WebSocket 每 3 秒重连并检测心跳；须收到合法 hello 才接收事件。
网络掉线覆盖为 offline，不当成 Agent error。

若 include/config.local.h 不存在，复制 config.example.h 并在本地填写配置。
已有文件不覆盖。USE_SAVED_WIFI=true 优先复用设备配置；无保存配置时调试页显示
Wi-Fi not configured，改为 false 并本地填写 SSID/password。不要提交凭据或固件二进制。
常规烧录不擦除独立 indicator-head NVS，也不改原厂舵机零点。

仅支持不分片文本帧；超过 8KB、非法 JSON/事件、空 ID 或 ID 超过 256 字节被拒绝。
不显示任意 detail 内容。调试页最多每秒 10 次，动画上限约 30fps，实际帧率受绘制耗时影响。
分配失败时保留 8-bit/文字页降级。

## 构建与烧录

首次安装工具（已存在时复用）：

```powershell
python -m venv .tmp/hardware-venv
.tmp/hardware-venv/Scripts/python.exe -m pip install esptool==5.4.0 platformio==6.2.0 pyserial
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m serial.tools.list_ports -v
```

本机端口 COM3；更换设备先核对芯片并备份原始 Flash 到 .tmp/hardware-backups。
备份含配网信息，不提交或上传。原厂及升级前完整备份的文件名、大小和 SHA-256
见 [接力说明](../../HANDOFF.md)；备份本身不随 Git 迁移。

烧录新设备或需保留烧录前状态时，先执行以下备份；COM3 改为实际端口，
时间戳文件名避免覆盖已有备份：

```powershell
New-Item -ItemType Directory -Force .tmp/hardware-backups | Out-Null
$backupFile = ".tmp/hardware-backups/stackchan-before-$(Get-Date -Format 'yyyyMMdd-HHmmss').bin"
.tmp/hardware-venv/Scripts/python.exe -m esptool --port COM3 flash-id
.tmp/hardware-venv/Scripts/python.exe -m esptool --port COM3 --baud 460800 read-flash 0 ALL $backupFile
Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
```

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --port COM3 --seconds 5 --send v
```

串口版本、head level/target/raw/automatic/fault 可确认固件和姿态策略。
上传和读取命令中的 COM3 均需替换为实际端口。
写入哈希校验不代替目视确认。screen-demo 只用于首轮屏幕 bring-up，须显式 -e screen-demo，
它显示标题、RGB 色块和 Uptime，不接日常状态。

## 固件回归

logic-test 在 ESP32 上运行纯头部策略、动画关键帧、协议解析和完成展示策略。
不初始化舵机、Wi-Fi、NVS。本轮运行 371 条断言、0 失败；结束后已恢复正式固件。

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e logic-test -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --port COM3 --seconds 5 --expect 'LOGIC_TEST_RESULT checks=371 failures=0'
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --port COM3 --seconds 5 --send v
```

事件驱动展示覆盖完成保持、新事件切换、去重、重连快照与完成期间头部保持；头部策略仍保持 20°限位。
本轮逻辑回归和串口实机验证不替代联网事件回放、真实模型调用、路由器断网或机械故障注入。
有效 12 小时采样与专项物理验收仍列在 [开发计划](../../docs/development-plan.md)。

参考：[StackChan Core](https://docs.m5stack.com/en/core/StackChan_Core)、
[M5Unified](https://github.com/m5stack/M5Unified)、
[StackChan 官方资源](https://github.com/m5stack/StackChan)。
