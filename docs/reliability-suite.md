# 2.0 可靠性改进工作记录

此文是本轮唯一现状/验收入口. 历史版本收据另列, 不能当作本轮完成证据.

## 范围与基线

- 用户任务: 可靠会话与操作、完整有界数学上下文、可追溯来源、长历史/PDF/预览体验、迁移/CI/文档/候选包.
- 最新有效基线: `adc9591611d9f150634136ee219d37499115b852`, 默认 `codex/initial`, 产品 `1.1.0`. fetch 与远端 HEAD 已核对, 无回退.
- 工作分支: `codex/reliability-suite`; 候选版本 `2.0.0-beta.1`, 新同步协议 2 与产品版本分开.
- 初始工作区干净. `npm ci`, `npm run build`, `npm test`: 基线 168 项通过.
- 本轮不沿用旧部署授权. 日常插件、真实桥、公开推送/发布均未授权, 先完成可审阅候选与验证.
- 只用原创材料测试, 不读取认证文件, 不改全局配置或私有技能, 不以旧整份备份覆盖后续数据.

## 逐项状态

| 条目 | 当前状态 | 实现/验证入口 |
| --- | --- | --- |
| A1 旧快照覆盖本地消息 | 修复; 实际恢复/持久化/重启链路通过 | `sessions.ts`, `remote.ts`, `sync/*`, `tests/mobile-load.test.ts` |
| A2/A3 待同步操作/幂等/删除隔离 | 已实现; 丢回执、CLI 后异常、不同终态、迟到凭证与设备隔离通过 | `sync/operations.ts`, `runtime/outbox.ts`, `runtime/receipts.ts` |
| B1 准备取消/统一生命周期 | 已实现; 主入口草稿/引用、分片准备取消和未知状态核对通过 | `runtime/lifecycle.ts`, `main.ts`, `composer-draft.ts` |
| B2/B3 能力协商/一致恢复 | 已实现; 有界只读恢复、单监听器、桥/CLI 进程变化及并发快照通过 | `remote.ts`, `bridge.ts`, `sync/*` |
| B4 环境诊断 | 已接设置; 异常隔离通过, 实际完整 CLI/模型/技能在独立探针中核验; 未在日常设置窗口操作 | `diagnostics.ts`, `settings.ts`, `desktop.ts`, `main.ts` |
| C 增量与迁移 | 已实现; 大于 4 MiB 历史、70 操作固定分页、设置 CAS、WAL 与迁移中断通过 | `sync/*`, `runtime/state-store.ts` |
| D 来源/回跳 | 已实现; 主工具成功读取接线、旧路径固定、重命名/同名/未落盘定位通过 | `sources.ts`, `view.ts`, `main.ts` |
| E 数学背景与精准追问 | 已实现, 定向和原生原创尾部公式 probe 通过 | `markdown-blocks.ts`, `context.ts`, `quote.ts`, `followup.ts` |
| F 历史预算/冷开显示 | 已实现; 原 Prompt/来源不改, 必需引用/未决问题保留, 真实模型补读被省略证明通过; SDK 冷开比较通过 | `history-budget.ts`, `history-window.ts`, `view.ts` |
| G1 修改卡片 | 已实现, 真实计数和中文状态定向回归通过 | `edit/card-state.ts`, `edit/panel.ts` |
| G2 PDF 当前页/区域 | 已实现; 当前页/两图/版本/缺图/传输/重放定向通过, 原生 PDF.js/canvas 通过; iPad 未验 | `pdf/*`, `scripts/pdf-region-native-probe.ts` |
| H 工程结构/CI/文档 | 视图/设置、操作生命周期、同步/存储/来源模块已提取; CI 已配置, 远端未运行 | `view.ts`, `settings.ts`, `runtime/*`, `sync/*`, `.github/workflows`, `AGENTS.md` |

## 已取得的证据

1. 基线 A1: 同一会话本地 m1/m2、远端 m1 经原 `restore_sessions` 后仅剩 1 条, m2 丢失. 这是原创数据的实际原函数结果, 不是对用户数据丢失的猜测.
2. 后端受控 HTTP: 超过 4 MiB 整体历史经 blob 分片和一致分页恢复; 丢回包后桥重启不重复 CLI; CLI 后异常未知状态与输入摘要拒改; 迁移保留旧字节、删除不复活. 不代表真实 iPad 或真实推理验收.
3. 来源/数学/PDF: 27 项定向回归通过. 原生 PDF 整页 1236×1600, 局部 1600×1179, 同页/同版本/总两图, 局部像素倍率约 3.01; 已检查六行原创公式, 不是 OCR 或数学正确性认证.
4. 原生长回答: 原创 43350 字符、93 个真实 Markdown 块, 选中尾部偏移 42821 的公式, 提供 529 字符源窗口并保留 `\\int`, 明确原回答截断. 临时 SDK 插件移除, 日常数据/enabled 集合未变.
5. 冷开 SDK 最新比较: 原创 240 消息, 1.1.0 基线约 2257–2312 ms/240 次 card 渲染/1440 DOM; 候选约 386–402 ms/40 次/342 DOM. 两方使用同一 18 ms 异步 renderer. 明暗与桌面/移动外形四场景, 非原生 MathJax 或 iPad. 继续加载 40 条保留旧节点, 焦点从 A 到 B 不改变历史回答基准或引起重绘.
6. 草稿 SDK: 重开、不同会话/连接、当前新捕获不被旧草稿来源静默覆盖、迟到回执不清新 scope 同文本输入的回归通过. 不是物理中文输入法验收.

## 数据与操作设计

用户实际 Selection、Explanation 背景和 WriteTarget 分离. 旧消息/Prompt/快照不改写. 新操作先保存本地不可变意图及消息 ID, 获得稳定连接作用域后绑定同 operation ID; 提交前持久化 Attempted 与解析后的请求摘要. unknown 只核对, 不自动再提交. 卸载或切 scope 后的迟到凭证单独按原操作保存, 不以旧整份内存状态覆盖新文件.

本机新规范文件与 legacy 文件分开, 留存原字节; 迁移、正常保存使用 stage/journal/readback/CAS, 未决日志与已提交备份有不同恢复规则. 普通缓存到期只针对原有修改预览/还原策略, 不删除未核对发送、幂等或聊天来源数据.

## 原创真实模型验收

独立 TEMP 工作区和 loopback 桥, 使用完整 CLI `0.164.0-alpha.11.1` 与实际启用的 `math-writing 0.3.0-candidate.4`. 仅一次 `gpt-6.1-sol / low` 推理, 每轮真实传入 text + 服务端发现的 skill 两项; 临时线程 `ephemeral=true/path=null`, 桥固定 read-only/approval never.

模型真实调用 `obsidian_history_read` 读取被派生历史省略的原创积分证明, 返回仅原证明中存在的核验词, 并正确补充实值/闭区间条件、核验 $f(t)=t$ 时 $1/2\leq1$. 这是小样功能验收, 不证明任意数学输出正确.

原探针只监听旧 `item/completed`, 漏了协议 2 的 `bridge/message-updated`, 导致 `assert(Output)` 误失败. 产品已保存最终答案; 失败 ledger/report 原样保留. 修正探针并通过 mock 回归后, 只读重建同一 TEMP 桥核对: 原数据身份、completed 操作、原 Prompt/快照/旧证明/答案均保留, 新增推理 0 次. 未重发原请求. 公共探针提供排他 ledger 和只读恢复模式.

## 回归入口与边界

- `npm ci`, `npm run build`, `npm test`: Node 24.17.0/Windows; 基线 168 项, 最终 **245 项全部通过, 0 失败/跳过**. 全量覆盖原问答、选区/检查证明提示、修改预览/确认前零写入/陈旧拒绝/去重/安全撤销、缓存 1/N/永不与重启、Tab/IME 事件、移动安全加载、旧数据及本轮故障链. CLI 真实推理单独记账, 不计入普通测试数量.
- `tests/mobile-load.test.ts`: 实际插件入口 + SDK/IndexedDB, 部分连接为真实 loopback HTTP + 可控 app-server; 不等同真实设备. 同一 scope 的后台回答、重复检查点、旧完成事件不会清掉另一个当前回合.
- `tests/sync*.test.ts`, `remote.test.ts`, `state-store.test.ts`, `receipts.test.ts`: 真实临时磁盘/HTTP、摘要、CAS、分页与中断恢复. 比较版本不依赖设备时间或文本长短, 终态冲突保留双方.
- `scripts/check-cold-history.mjs`, `check-stream-layout.mjs`: 原创长历史、实际 CodexView + 异步 SDK, 覆盖明暗/窄栏、三次追问回跳、草稿、滚动锚点; 不是原生公式或物理输入法.
- `scripts/pdf-region-native-probe.ts`, `quote-native-probe.ts`: 原生 Obsidian Markdown/PDF.js/canvas 组件, 原创内存材料; 日常插件/会话/笔记未替换, 测试资源已清理.
- `scripts/reliability-live.ts`: 默认不执行. `CODEX_RELIABILITY_LIVE=1` 且显式提供 TEMP 证据目录才允许单次真实请求; 已有 ledger 拒绝新提交, `CODEX_RELIABILITY_RECOVER=1` 只读恢复. 不上传私有课程或技能正文.

最终打包使用 `scripts/package-candidate.ps1`, 固定成员白名单并回读每个成员摘要; 外部 `candidate-manifest.json` 记录产品/协议、源码 commit、每个包及成员 SHA-256. 包中没有配对、聊天、修改数据库或私有技能. 升级顺序及数据/代码回退分开说明见 [migration.md](migration.md), 后端兼容表见 [sync-protocol.md](sync-protocol.md).

已实际生成并独立回读两个候选包: 插件 4 个成员、桥 16 个成员, ZIP CRC、各成员字节/摘要及产品版本一致. 对解包后的编译 `bridge.cjs` 在新 TEMP 配置/loopback 端口启动, 连接真实完整 CLI 查询 `/info` 与操作页, 验证桥版本 2.0.0-beta.1、协议 2、7 项能力及实际 math-writing 版本, 推理 0 次; 仅结束该测试拥有的进程树. 这是原生 Windows 编译产物预检, 不是日常安装或 iPad 验收.

旧 AGENTS 的归档比对最初直接比较整个文件而失败; 差异仅为新增的历史说明前言. 正确去除前言后, 原正文与基线逐字一致. 没有丢失或改写原维护历史. 失败检查与复核结果均保留, 不误记成产品缺陷.

本轮没有日常安装、现行桥重启、公开推送/发布或 GitHub CI 运行. 没有 iPad 真机, 物理中文 IME、实际锁屏/Wi-Fi/VPN 切换、部署后的完整 Windows 窗口流程仍待用户授权和设备复验. 原生组件与 SDK 结果不能代替这些验收.

## 本地提交与交付

- 基线 `adc9591611d9f150634136ee219d37499115b852`.
- 功能/故障回归阶段 `d3117a5`: 主入口、同步与存储、来源/数学/PDF、视图和对应回归; 已独立审查修复恢复竞态.
- 工程交付阶段: 公共探针/SDK 性能入口、CI、指南/兼容/回退、历史归档与白名单候选打包. 最终源码 commit 和压缩包/成员摘要由交付目录 `candidate-manifest.json` 绑定, 不在文档中自循环地嵌入包摘要.
- 2.0.0-beta.1 插件和独立 Windows 桥均为本地候选. 现行 Windows 日常插件仍为 1.1.0; 主维护工作树未改变. 继续部署需要本轮新的明确授权, 不复用 1.1.0 的批准.
