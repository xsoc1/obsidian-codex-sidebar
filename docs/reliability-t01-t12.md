# 材料、后端与恢复闭环

2026-11-05：**2.0.0-beta.13 已安装 Windows、升级独立桥并发布 GitHub；双平台 CI 与公开资产读回通过**。本轮从 `codex/multi-backend` / `734e49785ec3f8b7165f20fd249658d6e339059e` 开始，已 fetch 核对开发线、起始工作树干净；没有 reset 或移动旧标签。beta.12 发布源码为 `aa1502854b0468822e815ceb5b287a52ff57a3e7`。候选交付后用户明确授权本版“安装并发布”，包括 Windows「数学」库、独立远程桥与 GitHub 预发布。此前候选阶段未部署的记录保留为历史；旧版授权不扩展到后续版本。

## T01—T12 结果

| ID | 用户可见效果与实现 | 验证入口 | 当前限制 |
| --- | --- | --- | --- |
| T01 | `resolve_material` 统一预览、草稿与发送；旧回答引用与显式新 PDF 共存。自动捕获不混入引用，分别移除。捕获绑定 scope/session，迟到拒绝 | composer-material、material-browser、mobile-load 原创闭环 | 缺图、版本或能力不符保留草稿并报具体问题 |
| T02 | 核验已保存引用身份和正文版本；API 可用受限历史工具，其他路径预算预取；本轮历史覆盖可展开查看 | task-connections、api-streaming、backend-results、mobile-load | 工具最多 6 次、4 次续接、32,000 UTF-8 字节；未知自定义端点须明确选择工具能力 |
| T03 | 完整、部分、拒绝、未知、失败、取消分开保存；实际正文、模型、receipt、累计 usage 保留。显式继续产生关联新操作 | backend-results、backend-evidence、mobile-load | 未提供用量不补零；部分结果不可采用为编辑稿、不推进成功回合 |
| T04 | Fetch 真实 SSE，复用局部渲染及合并检查点；UTF-8、跨帧、终结、错误、usage、EOF 分别处理 | api-streaming、真实回环慢流、check-backend-cost | 原生 requestUrl 是明确的整段模式；Fetch/CORS 失败不自动换协议重发 |
| T05 | 停止等待立即释放 UI，不假称服务端取消；提交后 Agent 异常保留未知；迟到正文/usage 按原操作归档 | hidden-process、backend-results、backend-evidence、mobile-load | 没有正式只读查询接口的后端无法承诺找回服务端结果 |
| T06 | Promise 真正读回后才计成功；失败按有界退避重试最新版本。原作用域队列内捕获当前状态，终态撤销旧重试 | checkpoint-async-retry、sync-reliability-t06-t08、mobile-load 实际宿主异步失败 | Obsidian 不等待 onunload Promise；强制退出仅保证已经读回的屏障 |
| T07 | 最终裁定明确引用所见确切旧决议集合；正文、裁定与冲突状态一起保存并读回，旧审计保留 | conflict-finalization、mobile-load | 旧桥未声明 `conflictFinalization:1` 时拒绝因果裁定，不自动升级 |
| T08 | 真正 offset/length 范围读取；同一打开文件校验版本，单次完整性扫描及分片摘要，有界句柄/并发/缓存 | blob-range-read（1/8/32 MiB、短读、替换、损坏、真实 HTTP 并发） | 冷文件额外扫描 N 字节；扫描与范围读取量分开统计 |
| T09 | 浮层有默认折叠的实际解释背景，显示范围、闭合和缺失；选区与背景截断分列 | material-ui、material-browser、prompt/pdf | 旧快照没有分项信息时标明未知，不补造完整性 |
| T10 | PDF 精确文字可显式“补充同页图像”，保留文字锚点；同路径/版本/实际页码才能合并 | pdf-material、composer-material、mobile-load | 整页和局部合计两图；不自动附图，不冒充原始 LaTeX/OCR |
| T11 | 可选 SelectedBlocks 独立于解释 SourceRange，核验消息、版本与 DOM/Markdown 块后回跳；原分支引用身份保留 | quote-location、原生 quote-native-probe、浏览器历史导航 | 歧义、旧字段或映射变化明确退回原消息，不按重复文字猜位置 |
| T12 | 保存不含密钥的命名连接配置，侧栏切换配置/模型；请求冻结 provider/endpoint/protocol/model/effort/scope | task-connections、mobile-load Responses-only/default-high-default、material-browser | 凭据仅本进程内存，同可信端点/身份复用；目录不是推理权限证明 |

## 使用闭环

1. 在 Markdown 或 PDF 选段，打开“上下文”核对实际材料。展开“解释背景”查看定义、相邻源块、截断与缺失；选区不是允许写回的范围。
2. PDF 精确文字选区可点“补充同页图像”，明确选页图或区域。两张上限、实际页码、旋转、版本、各自图像引用共同保存。
3. 在回答中选一步追问，再主动框选新条件。浮层分别显示引用和附件，取消引用不会删图，清除附件不会删引用。草稿跨重启恢复原材料，不换成当前焦点。
4. 部分回答显示原因及“继续这份回答”。继续是用户发起的新操作，带原问题、已有正文、原材料与 `ContinuesMessageId`，不覆盖旧输出、不自动再 POST。
5. 在设置保存命名连接而不激活，或在侧栏切换已配置连接。新端点/身份缺 Key 时保留原连接与输入；同服务商换模型沿用同一历史，不自动搬运跨服务商会话。
6. “提问”与“生成修改预览”保持独立。预览完成且后端确认完整后才能采用；用户确认、宿主原文复核、幂等写入、回读、安全撤销不变。

## 协议与存储含义

- 会话规范仍为 schema 2、同步协议仍为 2；消息新增可选 `MaterialOrigin`、`BackendResult`、`ContinuesMessageId`、`ArchivedOnly` 和引用 `SelectedBlocks`。旧未知字段保持未知，原问题、Prompt、Task、来源和身份不重写。分支保留 Quote 原 SessionId；只有已核对祖先中复制的同版本正文可用于长引用。
- `BackendResult = {Text, Status, Metadata}`。Status 为 completed/partial/refused/unknown/failed/cancelled。Metadata 保留终止原因、实际模型、凭证、可选累计 usage、提交状态、等待状态和实际传输。操作的可选 WaitStopped 单独保存用户停止等待，不能因较晚正文被抹掉。cached input 是 input 的子项、reasoning output 是 output 的子项，不再次相加；重复终结事件不重复结算。
- 操作状态枚举沿用原协议。部分/拒绝的已结束请求以 failed 操作加原始 BackendResult 证据表达，不把正文删成报错；未知仍为 submission-unknown。空正文也保留操作证据。已确认完整结果不能被迟到停止降级；较晚观察保存在 receipt 的 Observations，不覆盖原完整正文/usage，也不撤销已经成功的缓存回合。
- 迟到结果是独立 receipt，只按原 scope/session/operation/turn/item 身份恢复；遵守会话/消息删除标记，`ArchivedOnly` 不计成功缓存回合。重启恢复只读取证据，不重新启动原 Agent 或推理。
- 受限 API 工具复用 `read_history_page` 的参数、字段、正文版本和页大小校验，宿主绑定当前连接与会话；额外限制轮数及累计 UTF-8 输出。没有通用 shell、eval、任意文件读写或新 vault 权限。无工具时完整引用按统一预算预取；仍超预算就指出必需原文不足并保留草稿。
- 请求协议独立于思考档次。目录声明 Responses-only 时默认/high/再默认始终走 Responses；默认只省略 effort 字段，不改变端点。当前 Run 快照绑定实际 Profile 和 Scope，防止设置更新、旧 driver 发出另一种请求。
- 连接配置是设备 localStorage schemaVersion 1，不含 Key/Key hash；设备历史归属仍按原 provider/endpoint 或 Agent 入口。可选身份标签用于同端点账号隔离；配置 ID、模型与历史 scope 分离。关闭表单清输入框，关闭插件清内存凭据。
- 冲突决议 v2 的 Supersedes 是确切父集合，不按时间戳或数组顺序裁定。重复 ID 内容冲突、缺父、环、跨 scope、证据摘要不符或确认期间有新正文/决议均拒绝。旧 v1 记录不补造因果。
- blob 返回旧 id/index/count/data/bytes，并可增加 version。旧桥省略 version 仍接受原有完整摘要验证；新桥检查文件对象和路径的 dev/inode/size/mtime/ctime，缓存该版本扫描及分片摘要，不每片整读。

## 验证记录与复现

起始 Node **24.17.0**，`npm ci`、`npm run build`、`npm test`：**323/323**。整合曾发现并修复旧夹具把主动附件写成自动 Snapshot、分支引用误拒绝、重新连接错误复用旧目录等问题；原行为要求保留，更新夹具以显式表达 native buffered/工具能力，不把 mock 说成真机。

```sh
npm ci
npm run build
npm test
npx tsx --test tests/backend.test.ts tests/backend-results.test.ts tests/api-streaming.test.ts tests/hidden-process.test.ts
npx tsx --test tests/checkpoint-async-retry.test.ts tests/conflict-finalization.test.ts tests/blob-range-read.test.ts
npx tsx scripts/check-backend-cost.ts
node tests/material-browser.mjs
node scripts/check-stream-layout.mjs
node scripts/check-sidebar-layout.mjs
node scripts/check-pdf-box.mjs
```

浏览器命令需要 `CODEX_LAYOUT_BROWSER`（Chromium）及 `CODEX_LAYOUT_APP_CSS`（本机 Obsidian 公开 app.css），每次用独立临时 profile。

- **自动化/集成**：最终全量回归 **426/426**，0 失败/跳过。原创端到端 `mobile-load` 实际执行统一图文/长引用→草稿读回→真实请求序列化→部分正文→显式继续新操作→编辑预览→确认前零写入→确认→安全撤销。另测停止后换模型、迟到 receipt、真实宿主异步保存失败且没有新 delta、默认/high/默认协议固定。整合检查另复现并修复完整结果被迟到 unknown 覆盖、旧线程替换/删除会话后迟到证据丢失，及已完成成功回合被归档标记回退；补入冷恢复和实际宿主回归。使用受控 HTTP、临时存储、真实临时子进程，不是供应商真请求。
- **浏览器**：320/420px 材料浮层、同页补图、独立移除、连接激活失败保留输入、配置选项稳定、部分结果按钮可用。流式旧卡片/选区/阅读锚点保留，明暗、窄栏、模拟 IME/Escape 与鼠标/触摸框选通过。截图实际检查，未用 CSS 尺寸冒充 iPad。
- **Windows 原生 SDK**：唯一临时探针，真实 MarkdownRenderer+MathJax 检查 4 类原创样本，约 49k 字符尾公式/混合块映射及短分析原文、旧版本拒绝通过。流式组件 51 个数学节点、0 数学错误，5 次只重绘变化卡片；切回使用缓存、0 次重绘、阅读位置保留。隐藏窗口的渲染等待在 `window.focus()` 后完成，不判为产品丢正文。候选验证时探针已卸载、日常插件仍 beta.12；随后经本次授权升级为 beta.13，未开启全局移动模拟。探针目录的清理命令被工具策略拦截，残留为未启用测试代码，精确本机位置仅记 ignored LOCAL_DEV；不伪称已经删完。
- **真实 Codex**：`scripts/followup-live.ts` 在隔离 TEMP、ephemeral/read-only/approvalPolicy never 下完成原创反三角不等式和矩阵交换子各 1 次请求，模型 gpt-6.1-sol/low，每轮实际启用 math-writing **0.3.0-candidate.4**。人工核读均先解释所问，再整合原说明；没有读取认证文件、真实笔记或改私有技能。
- **尚未验收**：没有可用的独立服务商测试 Key，因此真实 DeepSeek/Go/Google/OpenAI 直连未调用；iPad 真机、物理中文 IME、真实锁屏/VPN 换网尚未验收。独立桥随后经本次授权升级；本机与私有 HTTPS 握手不代表 iPad 真机通过。

### 同环境性能与资源

这是 Windows/Node 24 的合成传输和读取量，不是供应商速度、物理磁盘吞吐或计费结果。

| 场景 | 原行为/对照 | 候选实测 |
| --- | --- | --- |
| 四段回环慢响应 | buffered 首次可见 254ms、完成 254ms、0 delta | SSE 首次可见 58ms、完成 231ms、4 delta，正文逐字一致 |
| 一次异步保存失败、无新 delta | 从 734e497 取旧 Gate：1 次尝试、误计 1 成功、正文保存 0 | 2 次尝试、1 失败、1 重试、实际保存 1，待写 0 |
| 1 MiB / 16片 | 旧算法请求整文件累计 16 MiB | 范围读 1 MiB + 冷扫描 1 MiB，22ms |
| 8 MiB / 128片 | 旧算法累计 1 GiB | 范围读 8 MiB + 冷扫描 8 MiB，107ms |
| 32 MiB / 512片 | 旧算法累计 16 GiB | 范围读 32 MiB + 冷扫描 32 MiB，354ms |

blob 单下载句柄峰值 1；上限为 8 个句柄、8 个活动读、128 个已核验版本，每个读/扫描缓冲区至多 64 KiB。不用整文件缓存掩盖读取放大；文件替换、截断、同长度损坏、short read 和取消都验证失败/释放。真实回环 HTTP 中冷扫描未完成时状态查询仍可返回。测量时间不取代这些不变量。

## 候选、升级与回退

产品选 beta.13 是兼容增量候选，不移动旧标签。`scripts/package-candidate.ps1` 在已提交干净源码上构建；插件 4 成员、桥固定白名单 19 成员，回读成员/版本/SHA-256，candidate-manifest 绑定 SourceCommit。包中没有技能、真实笔记、会话、密钥、配对或本机路径。候选封存于 `12388901649faf0200cf31e1bd5eb73b65fd43e9` 时尚未安装或发布；随后部署与公开收据独立记录如下。

本轮保留 beta.12 四个程序资产副本；不读取认证文件。用户授权后已刷新私有数据备份，包含规范状态、blob/日志、草稿、IndexedDB、修改记录及配对，并核对备份可读。保留原 profile/device/dataIdentity，先桥后同配对客户端；不清空旧记录。程序可回退，v2 因果决议不能交给不理解它的旧客户端写回；需要保留新数据与完整导出，在独立副本核对，不覆盖升级后的记录。详见 [迁移](migration.md)、[连接](backends.md)、[协议](sync-protocol.md)。

## beta.13 部署与发布收据

- **Windows 实装**：四个程序文件安装并经原生插件重载读回 beta.13；33 个会话、250 条消息的原问题/来源、11 条修改记录、10 份写入计划、具体模型与思考/Fast/补全等选择、活动会话、提问框和编辑器缓冲未变。原生当前侧栏持有新插件实例，25 个公式节点存在。15 项原 localStorage 和两个当前库 IndexedDB 的内容核对一致。编辑记录最初的比较探针把 JSON 不保存的 undefined 键当成差异；归一化后全量序列化内容相同，没有用旧备份覆盖数据。
- **本机连接**：修复失效的已保存 CLI 路径后，实际官方 app-server 使用原 ChatGPT 登录，返回 8 个模型与 math-writing 0.3.0-candidate.4。本次部署不发起推理。
- **独立桥**：原服务已经停止，旧 CLI 路径失效，旧 loopback 端口落在 Windows 排除范围内。启动 beta.13 独立 runtime，换用有效 CLI 与允许的私有 loopback 端口；仅对齐两个既有 Tailscale 服务入口，未变更无关路径或开启公开转发。配对凭据、数据身份、原历史及 journal 版本逐项读回一致。私有 HTTPS /info 与 model/list 验证 beta.13、协议 2、隔离、conflictFinalization:1、historyReadBodyVersions:1、8 个模型和实际 math-writing。既有设备继续使用原 HTTPS 地址与密钥。
- **GitHub**：发布源码 `990de90d95c54ecbd19ec0ae5a58d4d638cd32fb` 已快进推送开发线 `codex/reliability-suite`，新标签 `2.0.0-beta.13` 未移动旧标签。[Windows/Ubuntu Node 24 CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/42030185618) 与[发布流程](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/42030191531) 全部成功。[公开 Release](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.13) 非草稿、预发布，7 个资产实际下载并核对 GitHub 摘要；candidate-manifest SourceCommit 与公开 tag 一致，插件 ZIP 4 成员、桥 ZIP 19 成员的白名单、字节数、SHA-256 和版本全部通过。公开单文件与 ZIP 对应项一致，Windows 四文件和独立 runtime 全部 19 成员与发布版逐字节一致。只对齐语义相同的 manifest/source-map 行尾和桥文档，主程序/bridge.cjs 无差异，未重启不变代码。正式版通道仍为 1.1.0。标签内文档记录发布前状态，开发线另补实际收据，不改已发布标签。
- **设备复验**：iPad 在 BRAT 指定 beta.13 后保持前台，重连核对原会话、模型与一次原创提问；再复验引用加附件、部分结果续写及换网恢复。当前没有 iPad 真机或真实付费 API 的新增验收。
