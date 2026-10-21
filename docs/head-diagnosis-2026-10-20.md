# 2026-10-20 头部不抬起诊断

后续修复：`2026.10.20-r3` 已通过 UART 就绪后的 VM 重新上电、充分预热和有限重试恢复舵机通信，
后台连接/关闭/重连的实机运动均已验证。最小固件证明两只舵机都能应答；此前优先检查共用硬件链路的判断
不能作为硬件损坏结论。最新证据见 [修复记录](head-connection-2026-10-20.md)。以下保留修复前的诊断过程。

已确认的直接原因是俯仰舵机位置读取失败，固件随后停用整个头部控制。
同一台设备仍能正常联网、接收 hooks 并切换表情。

进一步只读诊断发现 ID 1 和 ID 2 两只舵机均持续不应答，问题应优先沿它们共用的
舵机供电与通信通路检查。现有证据还不能确定是供电开关、连接线、信号转换电路或其他硬件环节。
本轮没有证明某一只舵机损坏，也不能把增加初始化重试当作已经修复硬件通信。

## 修复前的实机证据

原 r4 启动日志：

```text
firmware version=2026.10.16-r4 design=willump-led-v3 rise=20deg
head pitch-unavailable
status-client wifi-connected ip=192.168.3.44
status-client event=reasoning.started state=thinking display=thinking origin=codex count=1
status-client event=tool.started state=tool display=tool origin=codex count=2
```

因此工作事件已经到达设备，而头部在网络任务开始之前就初始化失败。

临时诊断固件保留原有显示、扬声器初始化和驱动，仅用读取与 Ping 检查舵机，
没有调用移动、扭矩控制、重新校准或 EEPROM 写入命令。
读取 NVS 得到：原厂零点 `599`、水平校准 `591`、自动模式 `1`。
这排除了本次因校准丢失或自动模式被关闭而不抬头。

| 检查 | 结果 |
| --- | --- |
| 主控 USB 电压 | 约 5.12 V |
| 主控电池读数 | 约 4.14 V，电量 100% |
| 机身 INA226 电池支路读数 | 约 4.126 V，芯片 ID 与连续采样配置可读 |
| PY32 扩展芯片 | 地址 `0x6F` 应答，版本 `0x41` |
| 舵机使能配置 | 输出方向、上拉与输出写入均收到 I2C 应答；输出寄存器 bit 0 为 1 |
| 1 Mbps、10 ms 超时、等待至约 2.5 秒 | ID 2 位置读取和 ID 1/2 Ping 均无应答 |
| 超时延长为 50 ms | 仍无应答 |
| 关闭扬声器后再读 | 仍无应答 |
| 扫描 12 档串口波特率 | ID 1/2 均无应答 |

共记录 27 轮探测，`ReadPos(2)` 均为 `-1`，错误码均为 `1 = ERR_NO_REPLY`。
波特率包括 1,000,000、500,000、250,000、128,000、115,200、76,800、57,600、
38,400、19,200、14,400、9,600、4,800。
关闭扬声器和延长等待均未恢复，因而不能把此次故障简单归因于声音占用或单次 200 ms 启动等待。

以上使能寄存器应答不能证明实际舵机电压正常。
[官方电源原理图](https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/1205/SCH_Power.pdf)
显示 INA226 测量的是电池支路；舵机 `VM` 是独立受控的 5 V 支路。
电池有电不能排除 VM 支路未输出或舵机线缆断路。
INA226 电压换算采用 [TI 数据手册](https://www.ti.com/lit/ds/symlink/ina226.pdf)规定的 1.25 mV/LSB。

## 原固件中的持续失效路径

`firmware/stackchan/include/head_motion.h`：

1. `begin()` 开启使能并等待 200 ms，然后只读取一次 `bus.ReadPos(2)`。
2. 首次位置无效就输出 `head pitch-unavailable` 并返回，`ready` 保持 `false`。
3. `update()` 最前面遇到 `!ready` 直接返回，之后不再读位置、不处理任何工作状态。
4. `v/e` 等串口命令也位于这个返回之后，初始化失败后连查询和重新启用命令都无法执行。

因此存在两个层次：目前舵机确实持续无应答；固件又缺少初始化失败后的诊断和恢复入口。
仅修 hooks 映射或调整抬头角度不会触及这条失败路径。
后续软件修复应保留运动限位与运行期故障锁定，另增加有上限的初始化重试、明确错误码，
并让只读状态查询在初始化失败时仍然可用。

## 当时提出的下一步判别

需要核查机身底部供电与主控/机身的连接，并在 VM 使能时实测舵机供电是否约 5 V。
如果 VM 不正常，沿 VM_EN、升压/开关和供电线检查；如果 VM 正常，再检查 Servo_TX/RX、
半双工信号转换和舵机连接。现有远程串口数据无法替代这项物理测量。

## 备份、恢复与日志

完整 r4 Flash 备份：`.tmp/hardware-backups/stackchan-before-head-diagnosis-20261020.bin`，
16,777,216 字节，SHA-256：
`62EE23B82582C3AA1BFF356CE08EC8F60C313A30306DE7F45F56FEA9EAC3AF8B`。
备份的 `0x10000` 应用区与原 r4 活动镜像逐字节一致。

临时诊断代码和恢复用原始镜像存于 `.tmp/head-diagnosis-20261020/`，生产固件源码未修改。
诊断后恢复原始 r4 应用，写入哈希校验通过；应用 SHA-256：
`6526AA9F56FB87106297D5249033AF3ED026745A51705E484F9F53C2175CAE62`。

- 原版启动：`.tmp/firmware-validation/head-diagnosis-20261020-boot.log`。
- 只读探测：`.tmp/firmware-validation/head-diagnosis-20261020-probes.log`。
- 恢复写入：`.tmp/firmware-validation/head-diagnosis-20261020-restore.log`。
- 恢复后日志：`.tmp/firmware-validation/head-diagnosis-20261020-restored.log`。
