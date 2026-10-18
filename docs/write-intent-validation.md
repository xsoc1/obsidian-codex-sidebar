# “写一个证明上去”自动预览识别修复

日期: 2026-10-18. 候选版本 0.12.1, 从已发布 0.12.0 代码及后续验证文档继续, 不回退工程。

## 用户报告与原因

用户明确指出失败请求是“写一个简短的17题证明上去, 只需包含思路”, 并非“解答”。当前模式为 auto/ai。0.12.0 的本地意图函数对这句返回 false, 实际主入口由此发送普通问答, 没有绑定修改 TaskSpec, 回答中的内容自然不会成为客户端预览。

自动模式由客户端意图规则选择流程, AI 在已绑定的任务中选择修改范围与正文。此次补齐明确的“写……上去/进去”“把……放进答案”“在答案处写”等请求, 并覆盖相应英文表达。普通“解答”、只给我看、否定写入、询问方法、引用说明保持问答。“仅问答”和回答引用继续优先。

规则集中在 `src/edit/intent.ts`, 由原 `edit_intent` 调用, 按原入口复用 `ChatEdits`、math-writing、AI 自选范围、差异渲染和确认式写回。未加模型工具或额外请求, 未改任务 schema、远程两输入契约、只读权限、确认/陈旧/撤销规则。未对模型输出做自动反转义或放宽校验。

## 可复现检查

先用原已安装 0.12.0 bundle 作为 VM 测试输入运行下列第二条用例, 稳定失败于 `User.Task.Action` 为 undefined, 预期 edit。直接意图检测用例也先失败。修复后同一主入口收到原句, 生成 text+math-writing 两输入、原来源快照及 AI 范围任务, 模拟结果产生真正 WritePlan; 确认前写入为零, 双确认仅一次、撤销与换焦点后快照重发通过。

```powershell
node --import tsx --test --test-name-pattern='short.*proof' tests/edit.test.ts tests/mobile-load.test.ts
npm run build
npm test
```

最终构建和 116 项测试通过, 包含原功能回归、同类请求及否定/方法/引用边界, 以及控件提示与发送入口的一致性。上述测试运行实际构建的 mobile-safe main bundle, 网络和写入宿主为 mock, 不冒充真机。

另外显式运行一次实际 Codex 请求:

```powershell
$env:CODEX_EDIT_TEST_CLI = '<actual installed codex executable>'
$env:CODEX_EDIT_SCOPE = 'ai'
$env:CODEX_EDIT_WRITING = '1'
node --import tsx scripts/edit-live.ts
```

原始输入仅为 `examples/study/Write-proof-mini.md` 的原创 2×2 矩阵题。实际模型 gpt-6.1-sol/low/Fast 关闭, 技能为 0.3.0-candidate.4, ephemeral/read-only/never, 两输入。完成的提案只在第17题答案标题后补出 $HE=E$, $EH=-E$, 因而 $[H,E]=2E$ 的思路; 题面、前后题与留白保留。运行时 JSON/范围校验、确认前零写入、双确认去重、安全撤销及陈旧拒绝通过, 宿主是内存写入器。原始命令/输出和完整收据留在 Git 外。

## 安装、重发与边界

这是待授权部署的候选。Windows 日常插件仍是 0.12.0, 四件资产哈希未变; 在用桥、技能、设置和真实课程笔记均未修改。本版没有原生 UI、手工 IME、多主题或 iPad 真机验收, 不用 VM 和真实模型请求代替这些验收。

升级后在输入框新发原句即可自动进入修改预览, 仍需用户确认写入。旧消息“重新发送”按既有约定保留原任务与原上下文, 不把旧普通问答暗中升级为修改, 也不捕获当前焦点替代旧来源。明确修改任务的重发则保留原绑定范围。
