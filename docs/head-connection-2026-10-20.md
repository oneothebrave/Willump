# 2026-10-20 后台连接与头部修复

已烧录最终固件 `2026.10.20-r3`，并使用真实后台停止、重启和舵机位置反馈验证：
收到有效后台 hello 后抬头约 20°，后台关闭或断线后回水平，重连后再次抬头。
空闲、等待审批、工作、完成和异常事件都不再改变头部姿态。

## 原因与判别

原固件上电后仅等待 200ms，第一次 `ReadPos(2)` 失败就返回；之后 `update()` 因 `ready=false`
永久跳过头部控制，连 `v/e` 诊断和恢复命令也无法使用。保存的水平 591、自动模式 1 均正常。
原策略还会在收到 idle 时回水平，与本次要求的“后台连接即抬头”不同。

首次诊断中两只舵机都不应答，详见 [历史记录](head-diagnosis-2026-10-20.md)。
用户从底部 USB-C 彻底断电重启后，初版修复采用 700ms 预热、三次重新供电，仍未恢复。
进一步最小固件关闭联网、动画和音频后，ID 1/2 都能正常应答，排除了当前持续硬件断路的判断。

同一次启动顺序对照测试中，VM 开启 700ms 后三次位置读取和原始 UART 请求均无应答；
继续等待 1500ms 后，同一个请求收到 `ffff02040002599e`，位置为 601。
在舵机就绪后启用扬声器、播放测试音、关闭扬声器和调用 M5.update 都保留正常应答。
证据支持修复上电初始化时序；没有发现扬声器与舵机的直接引脚冲突。

## 最终实现

- UART1、1Mbps、TX6/RX7 先就绪，再通过 PY32 IO0 关闭 VM 300ms、开启并预热 2000ms。
- 初始化为非阻塞状态机，失败后间隔至少 1 秒，最多尝试 3 次；耗尽后由连接变化或显式 `e` 重新开始。
- `v/e/x` 在初始化失败后仍可用。未校准设备可只读初始化并通过 `h` 人工校准，保存有效水平前不自动运动。
- 头部只消费 `displayed.protocolReady`：有效 hello 后目标 655，断线目标 591；稳定 350ms 后执行 900ms 移动。
- 保留 ID 2、水平至水平+64 的运动限位及运行期最多 3 次故障重试；原厂零点 599 只读。

本轮修改固件 C++ 和文档，没有修改 JavaScript/TypeScript。问号动画、审批音和 turn 完成音的原始载荷均在最终二进制中逐字节核对。
驱动配置与 [官方舵机实现](https://github.com/m5stack/StackChan/blob/main/firmware/main/hal/hal_servo.cpp)
和 [供电实现](https://github.com/m5stack/StackChan/blob/main/firmware/main/hal/hal_io_expander.cpp)一致。

## 最终实机验收

| 操作 | 连接状态 | 目标 | 位置反馈 | ready / fault / error |
| --- | --- | --- | --- | --- |
| 启动并收到合法 hello，显示 waiting | 已连接 | 655 | 653 | 1 / 0 / 0 |
| 对真实后台发送 SIGTERM | 已断开 | 591 | 590 | 1 / 0 / 0 |
| 重新启动后台，收到 hello 和 thread.idle | 已连接 | 655 | 653 | 1 / 0 / 0 |

这是舵机原始位置反馈，不是外部量角测量。三项检查通过后，后台已恢复运行，
`/health` 返回正常、来源 `codex-cli-hooks`、设备客户端数 1。
最终固件首次初始化即成功，`init-attempts=1/3`。此前 r2 也通过同样三项实测。

其他验证：`status-client` 与 `logic-test` 构建通过；实际逻辑测试源码的本机执行为 486 条断言、0 失败。
实际 `HeadMotion` 头文件配模拟硬件另验证 16 项，覆盖连接姿态、缺失校准时禁止运动但允许人工校准、
初始化三次耗尽后停止、失败时状态查询和显式恢复，均通过。
项目 `npm run build`、`npm run test:contract`、`npm test` 通过，Node 测试为 86 通过、2 跳过、0 失败。

## 备份与追溯

修改前的完整 16MB r4 Flash：
`.tmp/hardware-backups/stackchan-before-head-diagnosis-20261020.bin`，
SHA-256 `62EE23B82582C3AA1BFF356CE08EC8F60C313A30306DE7F45F56FEA9EAC3AF8B`。
源码、设备配置与工作区改动快照位于 `.tmp/hardware-backups/head-connection-fix-20261020/`。
常规写入仅覆盖应用区，原厂校准和 `indicator-head` NVS 保留。

最终设备构建副本：`.tmp/device-provisioning/head-connection-20261020-r3/stackchan/`。
应用大小 3,163,184 字节，SHA-256：
`4F197806D3F535D675FBBAA8124C42A55C5AEB4B8ADE74941E40E2A417309F8E`。
烧录写入哈希校验通过；活动配置在 `.tmp/device-provisioning/active.json`。
构建副本、备份和二进制含配网信息，只在本地保留。

本地证据：

- 最小固件：`.tmp/firmware-validation/head-connection-20261020-isolation.log`。
- 扬声器对照：`.tmp/firmware-validation/head-connection-20261020-phased.log`。
- 700ms 与延后读取对照：`.tmp/firmware-validation/head-connection-20261020-early-audio.log`。
- 最终构建：`.tmp/firmware-validation/head-connection-20261020-r3-build.log`。
- 本机逻辑及模拟检查：同目录 `head-connection-20261020-r3-native.log`、`head-connection-20261020-r3-integration.log`。
- 最终运动验证：同目录 `head-connection-20261020-r3-backend-transition.log` 及 `.json`。
