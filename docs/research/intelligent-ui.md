# Intelligent UI 调研

本页保留实施前的调研判断. 后续首版选择两类固定组件而不引入通用 UI 库, 使用与当前协议见[交互答案](../interactive-answers.md).

查阅日期：2026-11-13。目标：理解 Intelligent UI，并判断它是否适合现有 Obsidian Sidebar。结论是**保留完整正文，把交互作为按需附加能力；优先验证 OpenUI 核心与原生组件的轻量接法，不搬另一套聊天系统。**

## Intelligent UI 是什么，哪些能力可以接入

Intelligent UI 的重点不是统一换成卡片样式，而是让 AI 随任务选择文字、图示、输入控件与局部工具。解释一个概念可以配可调参数图；比较方案可以给可筛选表格；普通问题仍可只回答文字。

**ChatGPT 官方功能：** OpenAI 在 2026-10-07 公布的 Intelligent UI 使用原生可流式组件库与编译器，结合模型对内容、布局和交互的选择。官方明确该次更新面向 Chat，未改变 Work/Codex 模型。由此不能推断：把 Sidebar 换成某个模型，它就会得到 ChatGPT 的界面运行时。[官方介绍](https://openai.com/index/gpt-6-for-everyone/)、[帮助文档](https://help.openai.com/en/articles/20001598-intelligent-ui-in-chatgpt)。

**公开开发接口与产品功能不同：** 本次核对的公开文档没有给出可直接嵌入 Obsidian 的上述原生 Intelligent UI 编译器 SDK。官方 MCP Apps UI 路线是开发者提供 HTML 资源，在支持该协议的宿主 iframe 内渲染，经 JSON-RPC/postMessage 通信；不是下载 ChatGPT 的原生回答渲染器。Obsidian 需要自己实现相应宿主才有这类能力。[官方 MCP UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)。

下面的两个 Open Intelligent UI 是独立开源实现，不能把它们的架构、安全属性或许可证归给 OpenAI。

## 开源方向：保留聊天系统，增加受控的交互答案

**首选先验证 OpenUI 的 `@openuidev/lang-core`，只复用解析、组件约束与有限状态求值，接插件自己的原生 DOM 组件。** 不搬入其聊天界面、服务端或 `HtmlView`。这样最贴合当前工程的 TypeScript、MarkdownRenderer、现有 Codex/Go/DeepSeek 和 native buffered 路线；代价是需要一个明确有界的原生渲染适配层。这是技术选型建议，本轮没有运行插件原型。

### 三条路线的决定性差别

| 路线 | 已核实的架构与许可 | 对本插件的取舍 |
| --- | --- | --- |
| **Thesys `open-intelligent-ui` → OpenUI 核心** | 演示应用为 Next.js 16、React 19，要求 Node ≥24；依赖 `lang-core`、`react-lang`、`react-ui`。底层核心有独立解析器、提示生成、状态及 AST 求值 API，不依赖 React。演示与核心均为 MIT。 | **首选抽取核心，不接整套应用。** 官方 React renderer 不是原生 DOM renderer；组件适配仍需实现。核心可接完整文本或增量文本，不要求换聊天框架。[演示清单](https://github.com/thesysdev/open-intelligent-ui/blob/8ecdd17297d1f15cecfbc8750817dda5a576c401/package.json)、[核心 API](https://github.com/thesysdev/openui/blob/e0aec340cb4a07c5605d678eedb036dbb5313d60/packages/lang-core/README.md)、[核心许可](https://github.com/thesysdev/openui/blob/e0aec340cb4a07c5605d678eedb036dbb5313d60/LICENSE) |
| **CopilotKit `OpenIntelligentUI`** | 完整应用为 Next.js/React + CopilotKit runtime + Python FastAPI/LangGraph/Deep Agent；采用 A2UI 表格与 `generateSandboxedUi` 两条渲染路径。应用为 MIT，Websandbox 依赖为 Apache-2.0。 | **作为交互设计与桥接代码参考，不直接接入。** 会增加另一套 agent/runtime/chat；自定义图解路径执行模型生成 JS，与本项目边界冲突。[架构](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/docs/architecture.md)、[依赖](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/app/package.json)、[应用许可](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/LICENSE)、[Websandbox 元数据](https://registry.npmjs.org/@jetbrains/websandbox/1.2.1) |
| **A2UI 核心 + 本地组件目录** | 原 `google/A2UI` 当前重定向到 `a2ui-project/a2ui`。以 UI 数据消息、组件目录、客户端状态和框架适配器分层；`@a2ui/web_core`、`@a2ui/lit` 为 Apache-2.0。Lit 路线提供 Web Components，不需 React，但核心依赖本身也含 Lit。 | **互操作需求明确时的第二选择。** 可复用状态/校验/组件机制；比直接搬 CopilotKit 轻，但不能误称零框架依赖。当前版本文档不完全一致，需先锁定协议与 renderer 的配对。[架构](https://github.com/a2ui-project/a2ui/blob/58379ad4c7b23289992acea44e99126374e41063/README.md)、[核心元数据](https://registry.npmjs.org/@a2ui/web_core/0.15.0)、[Lit 文档](https://github.com/a2ui-project/a2ui/blob/58379ad4c7b23289992acea44e99126374e41063/typescript/renderers/lit/README.md) |

两个同名 Intelligent UI 仓库是不同团队的应用，不是彼此兼容的协议。**OpenUI** 是这里的 Thesys 语言/组件库；**AG-UI** 规范 agent 与前端之间的事件，支持不同传输；**A2UI** 描述 UI 与数据并由客户端组件呈现。采用 A2UI 不要求同时采用 CopilotKit 或 AG-UI，也不要求改用 A2A。[AG-UI 官方定义](https://github.com/ag-ui-protocol/ag-ui/blob/8a951d14144e7dde986ccec23364e01a36111a63/README.md)、[A2UI 分层与可选传输](https://github.com/a2ui-project/a2ui/blob/58379ad4c7b23289992acea44e99126374e41063/docs/site/src/content/docs/concepts/overview.mdx)。

### 后端中立：核心可复用，不等于演示应用已经兼容

- **Thesys 源码事实：** `LLM_BASE_URL` 分支自行生成完整 OpenUI 提示，调用兼容 Chat Completions 接口，再转成前端使用的 Responses 事件；Cloud 分支另走 Gateway。直接分支不是必须购买 Thesys 托管推理的方案，但也没有 README 所述的 Gateway 输出纠正步骤。不能据此认定任何特定 Go/DeepSeek 模型都能可靠生成合法 UI。[请求实现](https://github.com/thesysdev/open-intelligent-ui/blob/8ecdd17297d1f15cecfbc8750817dda5a576c401/src/lib/chat-handler.ts)、[直接 API 说明](https://github.com/thesysdev/open-intelligent-ui/blob/8ecdd17297d1f15cecfbc8750817dda5a576c401/README.md#use-any-openai-compatible-api)。
- **CopilotKit 应用源码事实：** 当前模型工厂限制 OpenAI/Anthropic 的指定模型命名；另由 Jev/TypeSafe 服务逐轮决定文本、A2UI 表格或自定义 UI，并发送最多四条、每条截断到 6,000 字符的近期对话文本。底层框架的可扩展性不能当成该应用已支持现有 Codex/Go/DeepSeek。[模型工厂](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/agent/src/model.py)、[路由器](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/agent/src/visualization_router.py)。
- **适配推断：** 使用 OpenUI 核心时，现有后端只需产出约定文本，不必复制演示的 HTTP/SSE 适配。native buffered 返回完整文本后可一次解析；有增量时才渐进呈现。实际生成质量、延迟与输出截断仍须分别验证，不能为“流式 UI”改变已选传输或自动重试推理。

## 源码中的沙盒边界

**Thesys `HtmlView` 仍然执行模型提供的 HTML/JS。** 所查实现为 `srcDoc` + `sandbox="allow-scripts"`，未授予 `allow-same-origin`；CSP 限制脚本/连接来源到四个 CDN，并禁止嵌套 frame、表单提交。但 `img-src` 明确允许所有 HTTPS 图片，所以注释中的“除了脚本 CDN 无网络”不能照抄为结论。其高度消息会核对 iframe 的 `event.source` 并夹限高度。按本项目禁止任意模型 JS 的约束，应从组件目录中移除 `HtmlView`，而不是把这套隔离描述为可直接接受的安全证明。[完整实现](https://github.com/thesysdev/open-intelligent-ui/blob/8ecdd17297d1f15cecfbc8750817dda5a576c401/src/lib/components/html-view.tsx)。

**CopilotKit 自定义 UI 也不是纯声明式。** renderer 将模型的 `jsFunctions`、`jsExpressions` 交给 `sandbox.run()`；最终 frame 的 CSP 含 `unsafe-inline`、`unsafe-eval` 及 CDN 允许列表。所查宿主桥暴露 `sendPrompt` 和 `openLink`，分别校验文本长度和 HTTPS URL；这些检查不意味着桥接调用已经得到用户授权，也不是“无网络”的承诺。可借鉴消息来源校验、尺寸限制和窄接口，不复制执行模型 JS 的路径。[renderer](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/app/src/components/generative-ui/open-generative-ui/renderer.tsx)、[frame/CSP](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/app/src/components/generative-ui/open-generative-ui/frame-content.ts)、[桥接校验](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/apps/app/src/lib/sandbox/sandbox-functions.ts)。

OpenUI 的核心 `evaluate()` 按 AST 类型、内建运算和注册函数分派；A2UI 的 processor 在组件批量更新前进行校验。两者的能力边界仍由宿主注册的组件、函数和 action 决定，**解析器不是权限沙盒**。OpenUI 还有 Query/Mutation/tool-provider 能力，不能因为只使用核心就默认开放。[OpenUI 求值器](https://github.com/thesysdev/openui/blob/e0aec340cb4a07c5605d678eedb036dbb5313d60/packages/lang-core/src/runtime/evaluator.ts)、[核心导出](https://github.com/thesysdev/openui/blob/e0aec340cb4a07c5605d678eedb036dbb5313d60/packages/lang-core/src/index.ts)、[A2UI processor](https://github.com/a2ui-project/a2ui/blob/58379ad4c7b23289992acea44e99126374e41063/typescript/core/web_core/src/processing/message-processor.ts)。

## 首选路线的最小范围

以下为建议约束，不是已实现能力：

1. **答案仍以 Markdown 为主体。** 只在确有收益时附受控 UI，例如数据表、参数滑块配函数图、证明依赖图。宿主固定组件及计算函数；模型只给数据、布局和允许的表达式，不给 JS、任意 HTML/CSS、shell 或文件操作。Markdown 片段仍交既有 MarkdownRenderer；UI 数学与交互参数必须区分已证明结论和演示数据。
2. **原生组件只在答案区域挂载。** 复用 `createParser`/`createStreamingParser` 和必要状态 API，不引入 `AgentInterface`、CopilotChat、Python 服务或另一套历史库。首轮不开放 Query/Mutation、MCP tool provider、自动 `ToAssistant`，也不让渲染生命周期提交模型请求。组件/函数/action 白名单须在运行时执行，不能只写在提示里。
3. **凭据与写权限留在既有宿主。** 渲染 payload、DOM 属性、组件本地状态均不放 Key。按钮如需写笔记，只能进入现有的预览、用户确认、目标/版本检查、日志及撤销链；渲染成功不授予写权限。跨会话、旧消息的按钮不能借当前选择获得新权限。
4. **先验证一个有用实例。** 用同一份“参数滑块 + 固定受控函数图”产物，分别检查 Windows 与 iPad 的触控、重开回放、公式和断网显示；保持 native buffered 也能在完成后使用。数据或语法失败显示原始答案及明确错误，不自动再调用模型，也不把残缺 UI 当成完整结论。

若后续目标变成“接外部 agent 的通用 UI 消息”，再优先验证 A2UI，而非持续扩大自定义适配层。**MCP Apps 是另一层工具 UI 资源与宿主通信扩展**：宿主需读取 `ui://` HTML 资源、隔离显示并实现双向桥；仅拿到工具返回的 HTML 文本不会自动显示组件。当前无需为了本地答案 UI 新起 MCP 服务。[MCP Apps 工作机制与宿主接口](https://github.com/modelcontextprotocol/ext-apps/blob/main/README.md#how-it-works)、[CopilotKit 独立 MCP 的实际边界](https://github.com/CopilotKit/OpenIntelligentUI/blob/8391a94c1c3939c679e40ddd7bfc08a9ef690e70/docs/architecture.md#standalone-mcp)。

## 现有插件的实际接缝与建议闭环

以下为本地源码观察；组件协议和流程改动仍为建议，没有实现：

| 当前模块 | 已有能力 | 可承担的接入职责 |
| --- | --- | --- |
| [view.ts](../../src/view.ts) | `render_messages` 使用 MarkdownRenderer 呈现回答、公式和来源；修改预览另有宿主组件 | 在完整回答旁挂载可选组件；保持稳定消息/组件 ID，不随每个文字 delta 重建整张卡 |
| [history.ts](../../src/history.ts) | 消息保留任务、原始来源、操作与保存状态，并用于历史重放 | 为 UI 规格与参数状态设计可版本化字段；原问题重发仍使用原快照，不暗中重新捕获 |
| [direct-api.ts](../../src/direct-api.ts) | 同时存在流式与原生整段路径 | 整段完成后同样可渲染 UI；滑动本地参数无需联网，也不自动提交新推理 |
| [edit/protocol.ts](../../src/edit/protocol.ts)、[edit/panel.ts](../../src/edit/panel.ts) | 结构校验、宿主目标绑定、差异预览、确认与陈旧拒绝 | 交互按钮只进入原有修改流程，不直接生成并执行文件操作 |
| [runtime/result-saves.ts](../../src/runtime/result-saves.ts) | 区分收到回答与持久保存 | UI 产物沿用保存屏障；保存失败不能靠重新调用模型恢复 |

建议的数据流为：**现有后端产出完整 Markdown + 可选 UI 规格 → 运行时校验与资源限额 → 宿主白名单组件 → 设备本地交互状态。** OpenUI 是可验证的候选解析实现，是否正式引入依赖，要由原型的体积、行为和移动端测试决定，不先承诺整库接入。

如果某后端已核对支持严格结构化输出，可以用其减少格式错误；它不是所有兼容 API/Codex app-server 的共同契约，不能直接给全部请求加同一字段。拒绝、截断、非法数据和数学错误仍须独立处理。[结构化输出官方边界](https://developers.openai.com/api/docs/guides/structured-outputs)。

### 对数学伴读最有用的第一步

1. **受控参数图。** 完整解释热方程例子后，附一个本地时间滑块查看衰减；函数来自受控表达式/固定计算器，不执行模型代码，图像仅作演示。
2. **符号与条件定位。** 从解释中点选符号，显示定义与原笔记/PDF 来源；主要推导继续完整可读，不隐藏成点击填空。
3. **基于当前状态追问。** 用户主动点“用当前参数提问”，宿主将参数状态和原来源快照交给现有会话。拖动、展开、返回来源都不自动请求模型。需要改笔记时仍点“生成修改预览”。

先用同一原创样例走通：捕获段落 → 完整解释与参数图 → 本地调参 → 明确追问 → 切会话再返回与重启回放 → 导出普通 Markdown 静态结果。UI 状态按设备/会话/消息/产物版本隔离；关闭插件后正文仍能读。这个小闭环成立后，再考虑更通用图解；不恢复已退役的课程/练习工作台。

## 版本、接入成本与尚缺证据

- **版本已查：** npm `latest` 的 OpenUI `lang-core` 为 **1.1.1**；A2UI `web_core`/`lit` 均为 **0.15.0**。CopilotKit 演示清单却固定在 **1.55.2-next.1** 等版本，不能将其代码直接视为当前 **1.87.1** SDK 示例。A2UI 主 README 已链接协议 v1.0，而 Lit README 仍推荐 v0.9；落地必须选择一个已核对的消息格式、catalog 与 renderer 配对。[OpenUI 元数据](https://registry.npmjs.org/@openuidev/lang-core/1.1.1)、[A2UI 元数据](https://registry.npmjs.org/@a2ui/lit/0.15.0)、[CopilotKit 元数据](https://registry.npmjs.org/@copilotkit/react-core/1.87.1)。
- **接入前须处理：** 原生 DOM 适配工作、状态持久化/回放与销毁、大小/深度/计算预算、主题与触控；这些不由一个解析库自动完成。OpenUI 核心带安装期遥测，文档提供 `OPENUI_TELEMETRY_DISABLED=1`/`DO_NOT_TRACK=1`；运行期遥测另为 opt-in，安装时应明确处理而非默认接受。主仓开源许可不替代依赖和外部图片/地图服务的许可核对。[遥测说明](https://github.com/thesysdev/openui/blob/e0aec340cb4a07c5605d678eedb036dbb5313d60/packages/lang-core/README.md#telemetry)。
- **本轮证据范围：** 只读公开文档、实际 renderer/CSP/桥接/求值源码、npm 元数据和现有插件源码。没有安装依赖、运行演示、调用模型或做 Windows/iPad 原型验收。只新增调研文档与维护记录；没有更改插件、安装或发布。源码可行性不等于各厂商模型生成质量与 iPad 真机验收。
