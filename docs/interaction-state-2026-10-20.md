# 2026-10-20 问号状态滞留与误报修复

已更新并重启电脑后台。固件仍为 `2026.10.20-r3`，本轮没有修改或烧录固件。
后台现在区分真实用户交互、自动审批和正常执行，用户回复后即恢复当前工作状态。

## 原因

旧后台收到 `PermissionRequest` 就进入 waiting，并把待审批记录放在最高优先级。
记录通常要等对应 `PostToolUse` 才删除。因此批准后执行耗时命令时，即使 CLI 已显示 working，
机器人仍会保持问号；输入摘要无法关联时还可能保持到轮次结束。

`PermissionRequest` 在审批流程开始时触发，自动审批也会经过该路径；它不能证明人工弹窗已经出现。
`PostToolUse` 则是在工具返回时触发，不等于用户作出决定的时刻。
事件含义见 [官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks#permissionrequest)。
本机对照确认：hooks 仍报 pendingApprovals=2，而 Codex 实际状态为 active、activeFlags=[]，并未等待用户。

第一次修复读到了真实阻塞等待状态，但现场测试发现异步问题卡片不会设置该标记，用户看到的是工作表情。
最终版本补充识别问题卡片创建和后续用户消息，覆盖这种不阻塞模型工作的提问。

## 改动

- 新增 `hooks/interaction.ts`：连接已有 daemon 的本地 Unix socket，每 250ms 读取绑定会话的状态。
  只发送 initialize、initialized 和只读 thread/read，不恢复会话、不启动任务、不响应任何服务器请求。
  `waitingOnApproval` / `waitingOnUserInput` 为真实等待；清空后立刻恢复当前工具或思考状态。
- 扩展原有 transcript 监听器：只使用当前轮次的类型化 AgentMessage.questions 与 UserMessage 元数据。
  问题卡片出现时进入 waiting，收到后续用户消息时解除。忽略问题、回答、命令和推理正文。
  每 250ms 增量读取；追完历史后才提交最新快照，并去重已处理卡片，避免重启时闪现旧问号。
- 发布器仍校验会话、轮次及终止状态，迟到读取不能覆盖新任务或完成状态。
  自动审批候选记录可以保留至工具结束，但不再覆盖已经确认的正常执行状态。
- `/health` 增加 interactionSource、waitingForUser、pendingUserInput、interactionObserver；
  `doctor` 报告实时交互监听的健康情况。

只读查询方式依据 [官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming)，
本机 CLI/daemon 为 0.163.0。异步卡片元数据属于该版本的 transcript 适配，已使用真实记录和回归样例验证。
Windows、无 daemon 或目标会话不在 daemon 中时使用原 hooks 回退策略；对应工具返回前可能仍无法确认审批结束。

## 实测与回归

自动审批对照：hooks 的 pendingApprovals=2 时，实时 waitingForUser=false，
设备状态流保持 command.started，没有产生问号事件。

最终真实问题测试：

| 事件 | 本机时间戳（毫秒） | 结果 |
| --- | --- | --- |
| 异步问题卡片创建 | 1792490031625 | 用户随后现场确认机器显示“问号” |
| 发出 waiting 状态 | 1792490031634 | 机器串口记录 face state=waiting，播放既有问号音 |
| 用户回复事件写入 | 1792490040527 | 用户回答“问号” |
| 发出 working 状态 | 1792490040665 | 约 138ms 后发出 command.started |

机器串口随后确认 `approval-audio stopped`、`face state=running`。
此时仍有工具在运行、未配对 hook 记录数为 1，证明不再依赖工具结束才解除等待。
138ms 为本次回复事件落盘至工作事件发出的实测间隔，不是所有设备和负载下的固定上限。

`npm test`：101 项，99 通过、2 跳过、0 失败。`npm run build`、`git diff --check` 通过。
新回归覆盖自动审批、批准后长命令仍执行、真实输入标记、异步问题与回复、历史回放、
重复卡片、跨轮次迟到事件、读超时/重连和未加载会话的回退。

本地备份：`.tmp/bug-backups/approval-resume-20261020/`。
本地证据：`.tmp/approval-resume-20261020/` 下的 node-tests.log、build.log、
live-final.jsonl、interaction-timing.json、device-final.log 和 backend.log。
记录只保留诊断元数据，未把问题或回答正文传给机器人。
