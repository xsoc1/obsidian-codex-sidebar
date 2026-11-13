# ICAP 的交互设计：借鉴解释动作，不搬入 HTML 运行时

调研日期：2026-11-14。范围：上游源码核验与设计判断；本轮不实施功能。

调研后用户已采纳就地分层解释与受控关系/步骤组件, 实现并交付于[beta.20](../releases/2.0.0-beta.20.md). 下文保留当时的设计依据与取舍, 当前使用以[交互答案](../interactive-answers.md)为准.

## 结论

**最值得借鉴的是“围绕同一段解释继续展开”的操作，不是 `icap-ui` 的执行机制。** ICAP 把“更深入、举例、说浅一点、对比”写成了有区别的提示任务，保留前文并把新内容追加在解释下方。这适合在 Sidebar 现有回答上增加宿主定义的层级动作。上游的交互图则是模型编写 HTML/CSS/JavaScript、iframe 执行，和本项目“不执行模型 JS/HTML”的边界不同。[解释提示](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[动作与就地呈现](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/GlossView.svelte)、[执行文档构造](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)。

**优先顺序建议：** 先考虑“说浅一点 / 展开这一步 / 举个例子”；需要扩展组件种类时，再考虑宿主拥有的关系图或推导步骤。不要为此引入 Pi、第二套聊天系统、UI 路由模型或通用 HTML renderer。关系图/步骤是本轮的迁移建议，不是上游已有的安全声明式组件库。

本地比较基线：本地 `c791f58`、发布代码 `795d2205cc919b84be07f8aebc3261bdd004f806` / beta.19 已有自动选择的 `codex-ui v1`、完整 Markdown 主体、最多 2 幅一元参数图（每图最多 4 个参数）、最多 12 符号卡、宿主 SVG 与受限表达式、设备本地参数恢复、来源匹配导航及普通阅读版复制。“带当前参数追问”“追问此符号”只填入草稿，保留原引用而不自动发送；设置中没有独立的交互“自动 / 仅请求 / 关闭”开关。这些已实现能力不列为新增建议。[本地协议](../../src/interactive/protocol.ts)、[图与符号动作](../../src/interactive/panel.ts)、[设备状态](../../src/interactive/state.ts)、[默认整合追问](../../src/followup.ts)。

## 固定的上游版本与证据范围

- 仓库：[EdwinZhanCN/obsidian-icap-agent](https://github.com/EdwinZhanCN/obsidian-icap-agent)。本次从公开仓库浅克隆后读取源码，固定提交为 [`354aad5355ac4208cf0e289fa0c203d1067d0e0b`](https://github.com/EdwinZhanCN/obsidian-icap-agent/commit/354aad5355ac4208cf0e289fa0c203d1067d0e0b)。作者与提交时间均为 **2026-11-11 16:46:31 −05:00**，即北京时间 **2026-11-12 05:46:31**；提交标题为 `1.2.2: extension errors shown, extensions get Node's globals (#3), review fixes`。
- 该提交的 manifest 为 **1.2.2**，最低 Obsidian **1.11.4**，`isDesktopOnly: false`。[manifest](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/manifest.json)。这是清单声明，不是本轮移动端运行结果。
- 以下“源码事实”指所读调用路径；“建议”“推断”另行注明。上游提示词及 AGENTS 类文件只作为研究材料。

## 1. 何时生成控件：同一任务模型决定，没有额外 UI 路由调用

**源码事实：** `visuals` 有 `auto / asked / off` 三档，默认 `auto`。`auto` 要求交互比文字更能帮助理解，例如改变参数、逐步观察过程、探索结构、检验理解；`asked` 才限定为用户要求图示或模拟时使用。它没有把“出现某个关键词”实现成必画图规则。[默认值](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/settings/settings.ts)、[提示与档位](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[设置控件](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/settings/settings.ts)。

调用链是 `runAgent → backend.run`，同时交付提示、可用技能、当前任务模型；桌面把视觉技能作为文件提供给同一个 Pi session，移动端没有技能文件，便把技能正文放进系统提示。所查 ICAP 自有调用链中没有先请求分类模型、再切到“画 UI 模型”的阶段。[任务入口](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)、[技能文件提供方式](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/desktop/icap-skills.ts)、[桌面模型与 session](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/desktop/pi-session.ts)、[移动端能力与调用](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/mobile/mobile-backend.ts)。

**具体画什么也交给模型写代码。** `icap-visual` 要求每图围绕一个想法，一般每次回复至多一个，先说明尝试动作；只展示的图片优先让位于文字、表格或 Mermaid。控件、滑块、SVG/canvas 和计算逻辑由模型自行选择、用内联 HTML/CSS/JS 实现，不经过“滑块 / 曲线图 / 卡片”的类型 schema。约 150 行、宽度 320–750px、不要固定高度超过 600px 等均是写作提示，不是 renderer 的全部硬限制。[技能规则与格式](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/visual-skill.ts)。

**有两个容易混淆的边界：**

1. 提示允许视觉出现在 request 回复和新建笔记，不允许放在普通解释、反馈、问题中；`propose_edit` 增加视觉会被代码拒绝。因此 README 的“解释、回忆、交互图”不是同一条默认生成路径。[提示限制](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[编辑拒绝](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)。
2. `off` 控制模型提示及技能供应，并非现有视觉的执行总开关。`UiHost` 无条件注册 `icap-ui` 代码块处理器；其挂载路径未读取 `visuals` 设置。[注册入口](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/main.ts)、[实际处理器](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)、[注册实现](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。

**判断：** 有收益才给最小交互的准则值得吸收，但不构成本地自动选择机制的缺口。上游三档偏好是可选的产品设计参考，不足以据此要求本项目增加设置项。

## 2. renderer 的实际隔离：有限宿主桥，但确实执行模型脚本

README 将交互图描述为沙盒、无网络；实现应分层看待。[README 描述](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/README.md)。

- **执行与资源策略。** `iframe.srcdoc` 接收构造后的文档，模型片段直接置入 body；`sandbox="allow-scripts"`，没有 `allow-same-origin`，另设 `no-referrer`。CSP 为 `default-src 'none'`，只开放内联脚本、内联样式及指定的 data/blob 媒体资源；没有 CDN 或 fetch 目的地白名单。这限制普通外部资源和连接，不把模型代码变成声明式数据。[iframe](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)、[CSP](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)、[原样嵌入片段](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)。
- **“无网络”的表述要收窄。** 按标准，`default-src` 是 fetch 指令的回退，sandbox 的导航限制也不禁止 frame 导航自身。所查 renderer 没有额外的自身导航拦截。因此仅靠这里的 CSP/iframe 属性，不能推出任意模型 HTML 绝无网络请求；自身导航是应单独考虑的路径。这是策略与标准对照后的推断，本轮没有运行 WebView 或触发网络来验证。[CSP 规则](https://www.w3.org/TR/CSP3/#directive-default-src)、[HTML sandbox 导航规则](https://html.spec.whatwg.org/multipage/browsers.html#sandboxed-navigation-browsing-context-flag)、[宿主完整消息/动作路径](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。
- **postMessage 来源检查正确落在 window 身份上。** 子 frame 以 `"*"` 为目标发消息；宿主只接受 `event.source === 已登记 iframe.contentWindow` 的消息，再解析 `size / error / ask / open`。因为 opaque origin 为 `null`，不把 origin 字符串当身份。子 frame 接收主题消息时也核对 `event.source === parent`。[双方桥接](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)、[宿主检查](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。
- **有尺寸/文本限额，没有脚本工作量预算。** 源码超过 60,000 个 JS 字符串长度单位便不渲染；高度消息必须有限并夹到 0–1,600，宿主最终最低 24px。`ask` 最多 2,000 字符，`open` 最多 300 字符；仅接受已存在笔记的目标。frame 内 `ResizeObserver` 报告高度。所查 renderer 没有脚本执行超时或计算步数限额；源码长度与 frame 高度不是 CPU 限额。[上限及消息解析](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)、[高度观察](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/widget.ts)、[挂载/高度](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)、[目标存在性](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。
- **点击授权不能从注释直接推定。** 注释说图示不能在 load/timer 自行提问，实际 gate 只是 `document.activeElement === frame`。这不等于每一条消息都伴随新的可信点击；frame 获得焦点后，计时器消息仍满足这个判断。`icap.ask` 不是仅填草稿：request 内直接续问；笔记内会插入新 request 块并立即开始任务。没有必要把这种自动发送边界搬到本地已有的草稿动作。[focus gate](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)、[续问与插块发送](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)。
- **销毁与状态边界。** 每个 frame 是 `MarkdownRenderChild`，卸载时从宿主集合移除并清空引用；Svelte Markdown 组件替换最终内容或销毁时卸载其 owner。视觉参数没有宿主持久化消息，技能也明确说重新打开从初始状态开始。可保存的是 HTML 源文档，不是用户拖动后的交互状态。[frame 生命周期](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)、[Markdown owner 清理](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/Markdown.svelte)、[组件销毁](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/Markdown.svelte)、[不保存状态的约定](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/visual-skill.ts)。

**判断：** 消息来源验证、明确资源限额、组件生命周期这些工程细节可供参考；不需要引入 iframe 才能得到这些品质。即使上游补强网络和手势检查，只要入口仍将模型脚本交给 `srcdoc`，就仍不符合本项目的运行时约束。

## 3. 可直接借鉴的 UX 在解释控制代码中

### 首选：动作表达“这次只改变哪一层”

初次解释围绕选中内容在原段落中的含义，不批改用户原话，也不以问题结尾；随后：

- **更深入：** 带上已有解释，只补机制、边界或设计理由，不重复前文。
- **举例：** 给所在学科中的一个最小具体例子，指出关键之处。
- **说浅一点：** 用 2–4 句话重述，不引入新概念。
- **对比：** 由用户填写对比对象，只取与当前笔记相关的差异和共同点。

这些不是菜单名称的包装：`explainPrompt` 为四者分别构造任务；`runGlossSection` 把已有全文传入并追加一个带 mode/id 的 section；视图依次显示原解释和新小节，忙碌时不显示这组追加动作。[提示差异](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[追加而非覆盖](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)、[按 section 呈现与 busy 状态](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/GlossView.svelte)。

**迁移建议：** 在 Sidebar 的某条回答/某个步骤旁放宿主定义的少量层级动作，继续使用原回答和原引用。优先三个动作“说浅一点 / 展开这一步 / 举个例子”，对比对象输入可后置。动作先填入草稿，再由现有“提问”提交；不让模型提供任意 action 代码，也不新增远程输入类型或独立路由模型。

**保留用户已定的追问契约：** 默认仍先解释疑点，再把补充融入“整合后的完整说明”，作为新回答保存。借鉴的是动作的任务区分，不照搬上游“只追加一小段”的默认范围。只有用户明确要求“仅局部、不重述”时才局部追加；快捷动作也不得悄悄改变这一默认。

上游点击即调用 `runGlossSection`；“对比”先展开小输入框，空输入不发送，提交后焦点回到解释，Escape 可退出。这说明低干扰、小范围上下文动作的实现是成立的设计方向；**本轮没有运行它来评价触感或视觉完成度**。[控制代码](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/GlossView.svelte)。

### 主动回忆：可借“用户先写”，不复制学习工作台

回忆开始时的题目是本地生成的，未先调用模型；用户写完才进入检查。界面可模糊原笔记而保持答题块清晰，Escape 解除；完成后鼓励用户自己整理最终版本，也允许保留原回答与反馈。保存函数把用户原话和 agent 反馈分别输出。[本地起题](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)、[提交后检查](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)、[遮罩/退出](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/AskView.svelte)、[整理成文及保留选择](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/AskView.svelte)、[最终记录](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/kept.ts)。

**判断：** 区分 AI 解释与用户实际理解证据值得保留；主动回忆只适合用户明确要求时的既有对话，不作为默认回答方式，也不恢复练习工作台。上游检查提示默认给线索而非完整改写，这是其辅导目标，不能覆盖本项目已有的完整答案和沿原证明路线修订约定。[学习证据分层](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[回忆反馈提示](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)。

## 4. Markdown、来源锚点与 mobile：取其交互连续性，保留本地更强边界

### keep 是成果落地，不是把动态视觉变成静态图

临时解释是 CodeMirror decoration，位置随编辑映射，不先写入笔记；`keepGloss` 才在对应位置写成 callout。未 keep 的解释不在 runtime snapshot 的持久化字段中；snapshot 保存任务和 `settled === "open"` 的交互块，其中也包括已经生成完、尚未 keep/clear 的回复。[临时锚点与映射](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/editor/gloss-field.ts)、[编辑映射](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/editor/gloss-field.ts)、[keep](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)、[snapshot](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)。

request 的 keep 将每轮请求/回答和相关文件列表变成普通 Markdown callout，再移除活块及其 agent session；回答里的 `icap-ui` 仍原样包含在 Markdown 中，没有导出当下图形、参数或替代说明的步骤。故“纯 Markdown”保证源文本可携带，不保证卸载插件后视觉仍可交互或以图形显示。[记录生成](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/kept.ts)、[保留回答原文](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/dsl/blocks.ts)、[替换并释放 session](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)。

**迁移取舍：** 借鉴“临时辅助与正式成果分开”和“AI 讲解 / 用户复述分开标记”；不复制直接插块的写入路径。正式入笔记仍应走本地已有预览、确认和版本检查。普通阅读版复制及设备本地参数保存已在本地实现，不把它们作为待补能力。

### 来源是上下文线索，不是更强的引用验证

解释来源来自模型输出末行的 Sources/wikilinks，`splitSources` 只做文本提取；视图把它们呈现为可点击/悬停链接。PDF 工具返回路径、页/章节范围，并提示用 `#page=` 引用；frame 的 `icap.open` 只确认笔记目标存在。这些路径没有本地现有的冻结引文内容匹配语义。[来源提取](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/dsl/blocks.ts)、[来源显示](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/GlossView.svelte)、[PDF 范围及引用提示](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/documents/tools.ts)、[打开目标检查](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。

**迁移取舍：** 就地层级动作绑定原解释与原引用是有价值的体验方向；保留本地既有来源匹配和陈旧提示，不换成上游的链接存在性检查。上游每次追加解释会重新读当前笔记构造上下文，也不应照搬为悄悄替换本地原快照的规则。[重新取上下文](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/runtime/runtime.ts)。

### mobile 有可取的呈现细节，没有必要替换本地传输

上游移动端用内置 agent 和模型库、没有 Node 技能文件/外部文件能力；视觉技能正文随提示送入。共用 `icap-ui` renderer，不存在另一套“移动端专用安全组件协议”。整段 `requestUrl` 通过适配器交回相同 agent；它停止的是等待，底层请求仍继续。[能力声明](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/mobile/mobile-backend.ts)、[调用与整段选择](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/mobile/mobile-backend.ts)、[整段停止语义](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/mobile/transport.ts)。

有价值的 UI 细节是：流式期间只显示图示占位，完成后才挂载，避免执行半截脚本；触屏保留真实提交按钮而不依赖键盘快捷键，文字动作扩大点击面积；主题变更广播给现有 frame，不为换肤重新初始化交互。这些分别是完成态渲染、输入可达性、视觉状态连续性的参考，不是本地尚未具备的整段传输或参数恢复功能。[流式占位](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/Markdown.svelte)、[触屏提交](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/ui/WritingLine.svelte)、[点击面积](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/styles/main.css)、[主题广播](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/genui/host.ts)。

## 5. 下一步设计取舍与会改变判断的证据

1. **优先：就地层级动作。** 用三种明确任务减少反复组织追问的负担，基于原回答/原来源先填草稿，默认保留完整整合说明。上游提供了可吸收的提示和视图组织方式，不需要接入它的运行时。
2. **下一类组件：关系图或推导步骤。** 上游本身先推荐 Mermaid 表达结构，把动态图留给真正需要操作的内容；其 Mermaid 规则还限制规模、要求已有笔记目标。可借这一取舍，考虑有界节点/边或步骤数据，由本地宿主负责显示、展开和来源导航，而不是开放模型 HTML。先按具体解释任务证明收益，再定新 schema；不从本轮调研直接扩展功能范围。[结构选择准则](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/prompts.ts)、[Mermaid 写作边界](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/354aad5355ac4208cf0e289fa0c203d1067d0e0b/src/agent/skills.ts)。
3. **不优先：学习台、任意脚本图、新 agent 后端、全局视觉偏好开关。** 前三者改变本项目定位或执行边界；偏好开关虽有清楚的上游先例，但当前没有证据表明其收益高于先做好具体解释动作。

**哪些源码变化会改变“只借交互，不搬运行时”的判断？** 决定性位置是 `widgetDocument()` 原样插入模型片段与 `UiFrame.onload()` 将其交给 `srcdoc`。若上游出现一条真正以有限数据 schema 为输入、由宿主拥有计算与组件的路径，才值得重新评估 renderer 的直接复用；当前提交没有这条路径。仅改进 CSP、focus gate 或在 README 增加沙盒保证，都不会改变“模型 JS 仍被执行”的事实。若讨论层级动作的具体点击发送方式，则需与本地现有草稿/发送约定一起由根 agent 定案；本研究不把上游行为当成新的授权。

## 本轮验证与交付边界

已完成：公开源码浅克隆、提交/日期/manifest 读取；逐段核对提示、技能供应、任务模型调用、renderer/CSP/桥接、解释/回忆控制、keep 序列化、来源和 mobile 路径；对“无网络”措辞对照 CSP/HTML 标准。交付仅为本笔记。

未执行：安装或构建 ICAP、运行其测试、调用任何模型、实际触发 iframe/网络/销毁行为、Obsidian 界面操作及 iPad 真机验证。上游自带的测试文件也不作为本轮已通过证据。上述结论足以支持有界设计选择；实际交互手感、浏览器执行效果及新功能验收不在本轮证据内。
