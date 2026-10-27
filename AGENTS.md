# Willump

Willump 把 Codex CLI hooks 转换为统一 WebSocket 状态，让 M5StackChan ESP32-S3 显示表情、
播放提示音并控制头部。链路为：Codex hooks → Node bridge → `agent.event` → 固件。

## 技术栈

- 电脑端：Node.js 24、TypeScript/ESM、`ws`、Node test runner。
- 可选模拟器：React、Vite。
- 固件：Arduino C++、PlatformIO、M5Unified/M5GFX、WebSockets、ArduinoJson。
- 主要目录：`server/`（bridge 与状态源）、`shared/`（共享适配）、`src/`（协议与模拟器）、
  `scripts/`（启动和工具）、`firmware/stackchan/`（固件）。

## 通用规范

- 遵循 `docs/code-style.md`；保持改动聚焦，不改写用户已有的无关改动。
- 未知值只在所属边界校验一次，向内传递已收窄类型。
- 默认保留在一个函数中；只有复用、复杂边界或清晰命名确有价值时才提取 helper。
- 尽量不用 `try/catch`；只在当前边界能够处理或补充错误语义时捕获。
- 不为推测性的低概率问题增加复杂度；先说明具体故障、可能性和成本并取得用户同意。
- 状态必须由明确事件推进，不能用静默时间猜测审批结束、turn 完成或 CLI 退出。
- 保持协议、hooks 隐私边界及硬件不变量；具体语义以 `docs/cli-hooks.md`、
  `docs/head-motion.md` 和 `firmware/stackchan/README.md` 为准。
- 特定场景的操作流程不要加入本文件；应放入按需加载的 Skill。

## 验证

- 开始前检查 `git status --short`，完成前检查工作树和 `git diff --check`。
- TS/JS 行为改动运行 `npm test` 和 `npm run build`；涉及 app-server 契约时再运行
  `npm run test:contract`。
- 固件改动运行相关本机回归和 PlatformIO 构建；策略 mock、编译成功与真机通过必须分开表述。
- 涉及屏幕、音频、联网、舵机或冷启动时，需要对应的实机证据；人工可感知结果由用户确认。
- 汇报实际执行的命令、结果、验证范围及未覆盖风险。没有证据不能声称完成。

## 禁止事项

- 不提交或输出 Wi-Fi 凭据、令牌、私钥、原始 transcript、`config.local.h`、Flash 备份或
  `.tmp/` 中的私有设备材料。
- hooks 和设备协议不得发送 prompt、回答、命令正文、文件内容或审批决定。
- 未经用户明确要求，不提交、推送、修改全局 hooks、烧录/擦除/恢复 Flash 或操作真实舵机。
- 不向 ID 2 以外的舵机发送命令，不改写原厂校准，不把其他设备的校准值复用于当前设备。
- 不把源码状态、构建成功、串口目标值或 mock 结果描述成已经烧录或已经由真机验证。
- 不执行破坏性 Git 操作，不覆盖用户改动，不用放宽断言来掩盖失败。

代码审查遵循 `REVIEW.md`。
