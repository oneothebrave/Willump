# Turn 完成音效

固件 `2026.10.16-r4` 在新的 `turn.completed → done` 事件发生时，播放一次
iOS App Store Face ID 确认“叮咚”音效。使用系统 `payment_success.caf` 转换的 WAV，
约 1.407 秒，默认主音量 64/255。来源、固定提交和文件摘要见 [素材说明](../firmware/stackchan/assets/README.md)。

## 触发行为

- 仅新的 turn 完成事件触发；单个工具结束、失败、启动和普通思考状态不响。
- 复用完成表情的 `celebrationGeneration`，重复完成 ID 不会重复播放。
- 连续两个不同的 turn 完成都能分别触发，即使 UI 没有绘制中间的工作状态。
- 断线、重启后的历史完成快照只恢复完成表情，不补响旧提醒。
- 退出 done 或断线时取消尚未结束的完成音；重连不会把取消的声音重新排队。

完成音使用 M5Unified 虚拟通道 1，现有问号审批音使用通道 0。
各通道分别取消，避免从完成切到审批时，旧声音的停止操作误停新提示音。
UI 只排队播放一次 WAV，音频由后台任务输出，没有加入阻塞等待。
现有完成笑脸与眨眼、问号落地动画、事件协议和电脑端 JS/TS 均沿用。

审批与完成共用 `firmware/stackchan/include/event_chime.h` 中的纯策略类，
各自持有独立实例，主音量仍为 64/255。此前的 `approval_chime.h` 已由该通用文件替代。

## 备份

烧录前完整 r3 Flash 备份：
`.tmp/hardware-backups/stackchan-before-turn-completion-audio-20261016.bin`。

- 大小：16,777,216 字节。
- SHA-256：`120A9D2FB691DD41F87894A464D70D21E4F3798F824152890D79EA810B1D887B`。
- 偏移 `0x10000` 的应用已与当前 r3 活动镜像逐字节核对一致。
- 源码、设备配置和工作区差异快照：`.tmp/hardware-backups/turn-completion-audio-20261016/`。

## 验证

实际 `logic_tests.cpp` 在 Mac 本地执行，457 项断言通过、失败 0 项。
新增覆盖首次历史完成快照、实时完成、重复 ID、连续完成、审批/完成切换、
失败与新工作状态、断线停止和重连后新的实时完成。
本地断言不能替代设备扬声器与现场听感验收。

`status-client` 与 `logic-test` 两个 PlatformIO 环境编译通过；网页构建与 Codex 协议契约
检查通过。Node 回归测试通过 86 项、跳过 2 项、失败 0 项。

应用镜像 3,162,272 字节，Flash 使用率 48.2%。SHA-256：
`6526AA9F56FB87106297D5249033AF3ED026745A51705E484F9F53C2175CAE62`。
已核对镜像内包含完整完成 WAV、审批 WAV 与问号逐帧数据；完成 WAV 的 PCM 头和载荷长度符合
当前 M5Unified `playWav` 要求。

2026-10-16 已烧录，写入哈希校验通过。串口确认：

```text
firmware version=2026.10.16-r4 design=willump-led-v3 rise=20deg
approval-audio ready=1 volume=64
completion-audio ready=1 channel=1
approval-animation ready=1 frames=41 fps=30 duration=1350
face design=willump-led-v3 framebuffer=1
status-client wifi-connected ip=192.168.3.44
status-client event=approval.requested state=waiting display=waiting origin=codex count=1
face state=waiting
```

串口采样窗口接收的是审批等待快照，没有捕获新的 turn 完成播放日志；实际听感尚未验收。
既有 `head pitch-unavailable` 仍出现，本轮未改动头部代码；原 r2 对照结果见
[问号动画记录](permission-question-animation.md)。

沿用设备配置的构建副本为 `.tmp/device-provisioning/turn-completion-audio-20261016/stackchan`，
清单为同级 `build-manifest.json`。备份、构建、烧录与串口日志位于
`.tmp/firmware-validation/turn-completion-audio-*-20261016.log`，仅保存在本机。
