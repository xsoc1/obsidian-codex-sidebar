# 开发与依赖

项目开发、独立 Windows 桥和 CI 的 Node.js 支持基线为 **Node 24**. 普通分支与 PR 在 Ubuntu、Windows 上执行 `npm ci`、`npm run build`、`npm test`. 工作流定义不等于本次已在 GitHub 执行; 具体平台、运行结果和候选验收以 [本轮验证记录](reliability-suite.md) 为准. Node 22 尚未列为本候选支持或已测版本.

```bash
npm ci
npm run build
npm test
```

已审阅并提交源码后, 可用 PowerShell 7 执行 `./scripts/package-candidate.ps1`. 它重新构建, 按固定白名单生成插件与独立桥 zip, 回读每个成员并核对 SHA-256, 另存含 source commit 的 `candidate-manifest.json`. 输出在忽略的 `dist/candidates/` 下, 不部署、不读取日常数据或发布. 重复路径已有包时拒绝覆盖.

构建生成移动安全的插件入口及独立 Node 桥. Obsidian 前端不能静态引入 Node/Electron; 桥与本机进程能力保留在桌面入口. 测试使用原创材料、临时目录与受控端点, 不需要把个人 vault、配对信息或认证文件放进仓库.

## math-writing 是独立的私有依赖

本仓库当前要求名为 `math-writing` 的技能, 但该技能目前为私有材料, **不在本仓库和发布包中, 也没有本项目可提供的公开下载地址**. 它不是 OpenAI 官方保证供应的同名技能. 仅克隆此仓库可以构建和运行自动化测试, 不能保证完成真实数学问答验收. 请向有权提供它的维护者取得合法副本; 缺少技能时插件会明确停止请求, 不静默跳过或换用另一个技能.

已取得副本的用户可按 Codex 支持的本地技能规则安装. 技能目录需包含带 `name`、`description` 的 `SKILL.md`; 个人级目录为 `~/.agents/skills/math-writing/`. Codex 也支持仓库 `.agents/skills` 等作用域. 安装后在 Codex 技能列表确认 `math-writing` 可见且启用; 如未识别, 按所用 Codex 版本的说明刷新或重启. 本插件不复制私有技能、不代改全局配置. 通用目录与发现方式依据 [OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills), 核对日期为 2026-10-27.

随后在 Obsidian 的 Codex Sidebar 设置中执行 **环境检查**. 该入口分别核对完整 CLI 运行包、登录、模型目录、当前库读取、`math-writing` 及远程能力, 不提交模型推理. 插件通过 `skills/list` 按实际当前库发现已启用技能, 每轮显式加载; 文件存在或诊断目录成功不等于数学输出已验收.

远程模式在 **Windows 桥主机** 安装并启用技能. iPad 不上传任意本地技能路径, 桥使用主机实际发现的技能; 客户端环境检查也会注明无法逐文件核对主机运行包的项目. 连接故障请查 [远程指南](ipad-setup.md), 新旧桥能力和数据升级参见 [本轮协议与迁移记录](reliability-suite.md).

## 验证与发布

- 自动化测试、浏览器布局、受控 HTTP、真实模型、Windows 原生和 iPad 真机分别记录, 不相互代替.
- 原生测试使用唯一命名的临时插件或原创 scratch; 测试后只移除本次拥有的资源, 并核对日常会话、笔记、编辑器及启用状态未变. 移动布局优先使用独立浏览器 fixture, 避免全局 EmulateMobile 污染其他 vault.
- 发起真实模型测试前确认授权及原始测试材料; 未知提交结果先核对, 不自动重试推理.
- 普通 CI 只有读取仓库权限, 不安装日常插件、不启动独立桥、不创建 release. 标签发布流程另行校验版本和公开资产.
- 当前 `2.0.0-beta.2` 尚未获得日常安装、在线桥升级/重启或公开发布授权. beta.1 已授权发布的事实见 [归档](history/reliability-beta1-20261027.md), 不扩展为本轮授权.

## 第二轮复验入口

```bash
node --import tsx --test tests/math-round2.test.ts tests/sync-round2.test.ts tests/checkpoint-round2.test.ts tests/history-render-state.test.ts tests/mobile-load.test.ts
node --import tsx scripts/check-sync-cost.ts
node --import tsx scripts/check-checkpoint-cost.ts
node scripts/check-history-refresh.mjs
node scripts/check-stream-layout.mjs
```

浏览器脚本要求 `CODEX_LAYOUT_BROWSER` 指向本机 Chromium 可执行文件, 使用独立临时 profile. 比较基线固定为 `4cc440be3e77dcd16d893ff6d9d7bcf1eee90b6a`, 通过 `git show` 读取代码, 不切换或重置工作树. 统计字节和工作量; 含固定 renderer 延迟的 SDK 时间不是原生 MathJax/iPad 性能.

`scripts/reliability-round2-live.ts` 需显式 `CODEX_ROUND2_LIVE=1` 和新的 TEMP 子目录 `CODEX_ROUND2_EVIDENCE`. 独占 ledger 存在后拒绝新提交; `CODEX_ROUND2_RECOVER=1` 只读恢复已有操作. 使用实际完整 CLI 和私有技能, 仅提供原创样本, 不读取日常桥或笔记. 本轮只做了一次真实推理. 原生公式入口 `scripts/quote-native-probe.ts` 需唯一临时插件加载, 不能覆盖日常插件.

当前约束见 [AGENTS.md](../AGENTS.md). 旧版本的真实验证与发布证据保存在 [1.1.0 及以前维护档案](history/maintenance-through-1.1.0.md), 其中旧的 current/pending 文字不表示本轮状态.
