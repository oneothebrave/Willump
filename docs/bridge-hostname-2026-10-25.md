# 2026-10-25 电脑地址变化后的连接修复

已备份完整固件并烧录 `2026.10.25-r1`。机器人改为连接
`larrys-mac-mini.local:8787`，真机确认收到后台 hello 和状态事件，头部已恢复抬起。

## 原因

用户从根目录执行 `willump` 后，启动脚本正确进入项目，bridge 和 hooks 接收端均健康，
但客户端为 0。电脑当前的局域网 IPv4 为 `192.168.3.47`，机器上次烧录的地址仍为
`192.168.3.49`。旧地址不响应，机器人 `192.168.3.44` 仍可在同一局域网访问。

问题来自电脑 DHCP 地址变化与设备中的固定目标 IP 不一致。仅验证脚本能启动后台，
不足以确认真机连接。

## 改动

- 新建私有设备构建副本，仅将原配置中的 `BRIDGE_HOST` 改为 `larrys-mac-mini.local`。
- 当前 ESP32-S3 SDK 已启用 `CONFIG_LWIP_DNS_SUPPORT_MDNS_QUERIES=1`；
  WebSocket 的主机名连接路径支持 `.local` 查询，无需增加另一套发现协议。
- 串口启动日志增加实际目标主机名与端口，固件版本更新为 `2026.10.25-r1`。
- 原项目的 `config.local.h` 保持不变；Wi-Fi 凭据、端口和舵机校准沿用。
  表情、音效载荷与头部控制源码逐字节确认未改动。

电脑主机名不变、设备处于可互访且允许 mDNS 的局域网时，电脑 IP 变化无需重新烧录。
更换电脑或修改 Mac 主机名后，仍需更新机器的连接目标。

## 验证

| 检查 | 结果 |
| --- | --- |
| 固件构建与烧录 | `status-client` 成功，写入哈希校验通过 |
| 实机启动日志 | `status-client bridge=larrys-mac-mini.local:8787` |
| 协议连接 | `hello version=1`，收到 `turn.completed` 快照 |
| 头部反馈 | ready=1、level=591、target=655、raw=653、automatic=1、fault=0、error=0、bridge=1 |
| 电脑后台 | bridge 与 hooks 均健康，客户端 1 |
| 根目录快捷命令 | `willump --check` 成功 |

后台沿用用户终端中已启动的服务。串口读取结束后连接保持正常。
本轮不修改表情切换策略；此前的思考/执行短闪诊断不属于此次连接修复。

## 备份与复现

烧录前完整 Flash 备份：
`.tmp/hardware-backups/bridge-address-20261025/stackchan-before-bridge-address.bin`，
大小 16,777,216 字节，SHA-256：
`6b81b178b4db72dc33886d08a3e63ea117478da0b53fd2a9c27fe33b2725665c`。
备份中的应用区已与原 r3 构建二进制核对一致。源文件及旧设备配置另有同目录快照。

当前设备构建副本：`.tmp/device-provisioning/bridge-hostname-20261025/stackchan/`。
固件大小 3,163,232 字节，SHA-256：
`7e4e99d6e384b82496a00aff3b01d6ed9b85c48114043f6966e891a4bd9cd44a`。
活动索引 `.tmp/device-provisioning/active.json` 已更新。

构建、烧录、串口、后台健康状态和验收摘要位于 `.tmp/bridge-address-20261025/`。
这些本地备份与构建文件包含配网信息，不提交 Git。
