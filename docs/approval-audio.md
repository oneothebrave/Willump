# 审批提示音

StackChan 内置 1W 扬声器，使用 M5Unified 的 `M5.Speaker` 播放提示音。
硬件与接口参考 [官方扬声器文档](https://docs.m5stack.com/en/arduino/stackchan/speaker)。

当前固件为 `2026.10.16-r4`。收到 `PermissionRequest → approval.requested` 并进入
`waiting` 时，播放[问号落地动画](permission-question-animation.md)，同时播放一次《英雄联盟》的 Enemy Missing（问号／敌人消失）音效。
本页下方保留 r2 音效更新时的验证记录；r3/r4 沿用同一审批 WAV 与音量。
r4 新增的完成提示音见 [Turn 完成音效](completion-audio.md)。
此前 `2026.10.16-r1` 的双音提示已替换。

- 同一次连续等待只响一次，重复事件不会反复播放。
- 断线、重启后的历史等待快照只恢复表情，不补播旧提醒。
- 退出等待或断线时，取消尚未结束的提示音。
- 启动、普通工作状态和完成状态不播放审批音；完成状态使用独立的完成音效。

默认音量为 `64/255`，音效约 `0.705` 秒。音量参数位于
`firmware/stackchan/include/event_chime.h`。音效使用 22,050 Hz、16-bit 单声道 WAV，
直接嵌入固件，无需 SD 卡或在线下载；来源、摘要及转换方法见 [音效说明](../firmware/stackchan/assets/README.md)。
音量和音色的实际效果需在机器旁听取确认。

UI 循环调用一次 `M5.Speaker.playWav`，由 M5Unified 的后台音频任务播放，没有为播放加入
阻塞等待。网络任务只传递提醒代数，不操作扬声器。电脑端 JS/TS、hooks 与协议继续复用。
r2 音效更新沿用既有表情；r3 仅替换 waiting 造型，头部目标、网络配置和舵机校准继续沿用。

## r2 音效验证记录

2026-10-16：`status-client` 与 `logic-test` 两个 PlatformIO 环境编译通过。
使用实际 `logic_tests.cpp` 在 Mac 本地执行，`413` 项逻辑断言全部通过；覆盖新增审批、
连续等待去重、历史快照、重复 ID、断线/退出等待取消与提醒代数回绕。
WAV 文件的头部、音频格式与数据区长度已核对，符合当前 M5Unified `playWav` 解析要求。
本地执行不等同于 ESP32 上的实机音频或听感验收。

正式固件已从 Mac 烧录，应用镜像 `1,135,648` 字节，写入哈希校验通过。
镜像 SHA-256 为 `CF6C2BE0DF0C0075C200C9737C7FAFAAE95F15A70E71F42F71DE93B533BCF1F4`。
串口确认 `firmware version=2026.10.16-r2`、`approval-audio ready=1 volume=64`，
Wi-Fi 已连接并收到 `approval.requested`；水平校准 `591`、自动模式和 `fault=0` 保留。
重连时的历史审批快照恢复等待表情，没有生成声音播放日志，符合静默恢复策略。
真实审批测试已再次触发，测试命令执行成功；现场听感等待用户确认。

烧录前完整 Flash 备份：`.tmp/hardware-backups/stackchan-before-lol-question-ping-20261016.bin`，
大小 `16,777,216` 字节，SHA-256 为
`01267083413D479FACD5CA60F2610CC6140A4EE71498AE54FAACDACD127B6108`。

r2 沿用设备配置的构建副本为 `.tmp/device-provisioning/lol-question-ping-20261016/stackchan`。
构建、烧录与串口记录位于 `.tmp/firmware-validation/lol-question-ping-*-20261016.log`。
设备配置、备份与固件镜像只保存在本机。
