# 审批素材

## 音效

`lol_enemy_missing.mp3` 是《英雄联盟》的 Enemy Missing（问号／敌人消失）信号音效。
游戏音效归 Riot Games 所有。保留下载源文件，供核对与重新转换。

来源：[lol-ping-overlay / sounds/q_mark.mp3](https://github.com/alibaztomars/lol-ping-overlay/blob/f10d7a448f56bfeb35dd8e49dae78c7e8ab9bc8b/sounds/q_mark.mp3)。
该项目的 README 将 `q_mark.mp3` 对应为 Enemy Missing。

- 固定来源提交：`f10d7a448f56bfeb35dd8e49dae78c7e8ab9bc8b`。
- MP3 SHA-256：`a6c9349640ebc0fddf3e8d48cbba708b842321fc3dff59de9ecbf09454bc554b`。
- `lol_enemy_missing.wav`：单声道、22,050 Hz、16-bit PCM，15,552 帧，约 0.705 秒。
- WAV SHA-256：`3359d20d8e0d55cbd0201e45b0910d169f77839b7705d91b424fa6764f78fb44`。

在 Mac 上转换：

```sh
afconvert firmware/stackchan/assets/lol_enemy_missing.mp3 \
  -o firmware/stackchan/assets/lol_enemy_missing.wav -f WAVE -d LEI16@22050 -c 1
```

PlatformIO 向 `status-client` 镜像嵌入 WAV，机器人无需联网下载或读取 SD 卡。
音效只播放一遍，由 M5Unified 后台音频任务输出。

## 问号落地动画

`lol_enemy_missing.rgb565` 来自用户确认的
[`output/permission-question-demo.html`](../../../output/permission-question-demo.html) 中的 41 帧。
它使用《英雄联盟》Enemy Missing 的金色问号、触地回弹与地面波纹；游戏素材归 Riot Games 所有。

- 官方外观参考：[Riot Smart Ping](https://support.riotgames.com/en-us/league-of-legends/gameplay/smart-ping)。
- 动画来源：[enemies-are-missing / ping-medium.webm](https://github.com/unoptimal/enemies-are-missing/blob/master/ping-medium.webm)。
- 原 WebM SHA-256：`a992e386d13e4cd6fa3c879d8e2aeb2bf3b97590c010c821bc721abfb1eb63c1`。
- 演示使用原片裁剪后的前 41 帧，30 fps，1,350 ms 后保持最后一帧。
- 固件每帧为 118×203 像素，坐标 (101,8)，已合成深蓝背景 `#060e18`。
- 数据为逐行 RGB565 大端，无文件头，每帧 47,908 字节，总计 1,964,228 字节。
- 动画 SHA-256：`e2e1e5902bd640d11a06149e763eb0596ee6ca5452b2111da691ee840ef7f8a2`。
- `lol_enemy_missing.json` 保存演示摘要、帧数、坐标与数据摘要，供构建时核对。

安装有 WebP 解码支持的 ffmpeg 后，在仓库根目录重新生成：

```sh
python3 scripts/build-permission-animation.py --ffmpeg /path/to/ffmpeg
```

转换只读取本地演示中嵌入的帧。固件从 Flash 直接绘制 RGB565，不在运行时解码视频或图片。

## Turn 完成音效

`ios_payment_success.caf` 为 iOS 的 `payment_success.caf` 确认音效，
用于用户指定的 App Store Face ID 确认“叮咚”。原始音效归 Apple 所有。
文件取自系统声音提取归档，保留 CAF 供核对，固件仅嵌入转换后的 WAV。

- 固定来源：[extratone/iOSSystemSounds / caf/payment_success.caf](https://github.com/extratone/iOSSystemSounds/blob/04048879c4b16f2372009e1a1d75207647ce16da/caf/payment_success.caf)。
- 来源提交：`04048879c4b16f2372009e1a1d75207647ce16da`。
- 原 CAF 大小：128,234 字节。
- CAF SHA-256：`ba47bf09170144c5c0b02785a487e43429a6f2008a5f9389a1385f04c2b1c0b9`。
- `ios_payment_success.wav`：单声道、22,050 Hz、16-bit PCM，31,035 帧，约 1.407 秒。
- WAV 大小：62,114 字节，44 字节标准 PCM 头。
- WAV SHA-256：`7fac67f9af16685919c5717098ba7e96f76a0986e73eb64264535d80f1f80bf0`。

转换使用 ffmpeg 7.1 解码和重采样为原始 `s16le`，再由 Python 标准库 `wave`
写入单声道 22,050 Hz WAV 头。未加入合成音、增益或重复播放。
使用方法及触发策略见 [Turn 完成音效](../../../docs/completion-audio.md)。
