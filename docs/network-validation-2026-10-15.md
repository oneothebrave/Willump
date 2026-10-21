# 新 Mac 机器人网络恢复记录

日期：2026-10-15。源码提交 `38f867f`；硬件为 ESP32-S3 rev 0.2、16MB Flash，
MAC `7c:4f:ad:ae:30:08`，串口 `/dev/cu.usbmodem21401`。

原设备版本为 `2026.10.13-r1`、`willump-led-v2`，Wi-Fi 未连接。
已完成 16MB 原设备备份，文件与 SHA-256 见 HANDOFF。

## 本次处理

- 同步新版源码 `2026.10.15-r1`、`willump-led-v3`，保留 Mac 适配与依赖修复。
- 用户指定精确 SSID `DuanWu`，并确认沿用已提供配置中的密码。
- 使用 `.tmp/device-provisioning/duanwu-20261015-tar9m7bx/stackchan` 独立构建并常规烧录，写入哈希校验通过。
  原 `config.local.h` SHA-256 仍为 `879054bc371f83a2711f9587b805f45c1deec5f24c8a9856c9f7e3912c6a41a8`；Mac 网络设置未修改。
- 应用镜像 1,079,424 字节，SHA-256 为 `8d57c71db67aa5d7f2ab5f3757892c2266a5737ccd3107a4558c5595e52cf756`。
  常规上传保留 `indicator-head` NVS，未擦除全部 Flash。

## 验证结果

| 检查 | 实测结果 |
| --- | --- |
| 固件与绘制 | `2026.10.15-r1`、`willump-led-v3`、framebuffer=1 |
| Wi-Fi | `wifi-connected ip=192.168.3.44` |
| 电脑目标 | `192.168.3.49:8787/status` |
| 协议 | `connection=Connected`、`hello version=1` |
| 事件接收 | `thread.idle state=idle display=idle origin=codex count=1` |
| 头部 | level=591、automatic=1、fault=0 |
| 电脑服务 | bridge 与 hooks 健康，客户端 1，CLI hooks 接收计数 0 |

证据保存于 `.tmp/firmware-validation/duanwu-20261015-serial.log`；活动设备配置索引为
`.tmp/device-provisioning/active.json`，包含上述镜像与连接验证元数据，不包含密码。

本次确认机器人已通过 Wi-Fi 接收 bridge 的初始 idle 快照。真实交互 CLI hooks、
全表情与头部回放、路由器中断恢复及连续稳定性仍待验收。
后续构建/烧录当前设备使用独立设备配置，具体命令见 [macOS 环境准备](macos-setup.md)。
