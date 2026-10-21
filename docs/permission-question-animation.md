# 审批问号落地动画

用户确认的演示为 [`output/permission-question-demo.html`](../output/permission-question-demo.html)。
固件 `2026.10.16-r3` 用同一组 41 帧替换 waiting 的方眼平嘴，保留现有《英雄联盟》问号音效。

## 显示与时序

- 进入 `waiting` 后以 30 fps 播放问号下落、触地回弹与地面波纹，共 1,350 ms。
- 动画结束后保持第 40 帧，直到审批状态结束；长时间等待不会循环或消失。
- 相同 waiting 状态内的普通通知不重新开始动画。
- 新审批仍只播放一次约 0.705 秒的问号音效，音量为 64/255；历史快照不补播声音。
- 屏幕为 320×240，问号帧为 118×203，左上角 (101,8)，保留底部连接点。

动画直接从 Flash 读取 RGB565，继续使用现有帧缓冲；没有加入逐帧图片解码、阻塞等待或网络下载。
其他表情、头部策略、Wi-Fi 配置和舵机校准沿用原实现。电脑端 JS/TS、hooks 和协议未改动。
素材来源、格式和重新生成命令见 [素材说明](../firmware/stackchan/assets/README.md)。

## 备份与构建

烧录前已保存并重新核对完整 Flash 备份：

`.tmp/hardware-backups/stackchan-before-permission-question-icon-20261016.bin`

- 大小：16,777,216 字节。
- SHA-256：`CDF57F2CF8A5778AA1EBA3E813C53884372D4C705BB1D34F56758A5B19B44FB1`。
- 偏移 `0x10000` 的应用与此前 r2 活动镜像逐字节一致。
- 源码、原设备配置与工作区差异另存在 `.tmp/hardware-backups/permission-question-icon-20261016/`。

本次沿用设备配置的构建副本：
`.tmp/device-provisioning/permission-question-landing-20261016/stackchan`。
构建清单位于同级 `build-manifest.json`，设备配置、备份和完整镜像仅保存在本机。

## 验证

`status-client`、`logic-test` 编译通过。实际 `logic_tests.cpp` 在 Mac 执行，423 项断言全部通过，
包含动画关键时间点、结束保持、长时间等待和 uint32 最大值下的帧边界。
Node 回归测试通过 86 项、跳过 2 项、失败 0 项；网页构建与 Codex 协议契约检查通过。

固件应用镜像 3,099,840 字节，Flash 使用率 47.3%。SHA-256：
`636DA4376DF50915878731D5FC5C897B595083D330E8D185DFF7D49981440F2B`。
构建后已核对镜像内包含完整且一致的动画与音频数据。RGB565 还原图已检查落地各阶段。
这些检查不能替代实屏目视与现场听感确认。

应用已写入 `0x10000`，esptool 报告 `Hash of data verified`。最终串口确认：

```text
firmware version=2026.10.16-r3 design=willump-led-v3 rise=20deg
approval-audio ready=1 volume=64
approval-animation ready=1 frames=41 fps=30 duration=1350
face design=willump-led-v3 framebuffer=1
status-client wifi-connected ip=192.168.3.44
status-client hello version=1
status-client event=approval.requested state=waiting display=waiting origin=codex count=1
face state=waiting
```

本次 r3 启动与复查均报告 `head pitch-unavailable`，尚未确认原因。临时写回原 r2 应用做对照，
同样复现；随后已恢复 r3 并再次核对版本、动画资源、扬声器与联网状态。
头部驱动和控制代码与 r2 逐字节一致，本次没有改动头部校准或控制策略；
不能用此前的 `automatic=1/fault=0` 记录代表本次头部已通过验收。

日志位于 `.tmp/firmware-validation/permission-question-landing-*-20261016.log`。
最终写入日志为 `permission-question-landing-final-upload-20261016.log`，
最终串口日志为 `permission-question-landing-final-serial-20261016.log`。
