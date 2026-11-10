# 选择连接方式

当前 beta.15 的结果保存、模型依据、签名续轮、字段导出、PDF 来源及阅读返回见 [R01—R09 验证与兼容说明](reliability-r01-r09.md)。真实厂商 Key 与 iPad 验收边界以该表为准。

## beta.13：配置与活动连接分开

先填写服务商、模型与必要的协议/身份，选择“保存配置，不连接”。侧栏“会话与连接”中可切换已保存配置，显示实际活动连接及能力；API 模型下拉会重建匹配 driver，不只改显示文字。失败保留原连接与配置草稿，成功才切换；目录迟到结果不能覆盖新配置。

请求协议独立于思考档次；Responses-only 模型在默认/high/默认间不会跳到 Chat。自定义端点不默认假设支持函数工具，可关闭受限历史读取而使用预算预取。本轮原问题、引用、图文附件和历史共享预算，用户可展开“本轮历史覆盖”。部分正文可复制并明确继续，不自动重发。用量缺失显示“服务商未提供”。

当前候选、状态契约、官方协议依据和验收边界见 [T01—T12](reliability-t01-t12.md)。

## API 直连

打开 Codex Sidebar 设置, 在 **API 直连** 选择服务商, 填入 **直连 API Key**. 从 beta.5 起, 点击 **加载模型**, 在 **上游模型** 选一个 ID, 再点 **启用 API 直连**. beta.4 或服务商没有提供列表时, 手动填写 **API 模型 ID**. 最后发一个短问题确认调用权限. Windows 和 iPad 使用同一入口, 设备需要能通过 HTTPS 访问所选服务商.

从 beta.6 起, **启用 API 直连** 的结果显示在按钮旁边. 失败时按提示更正后直接重试, 不用重新选择模型. 成功后密钥输入框清空, 本次运行仍可继续使用直连. 关闭设置也会清除未提交的 Key.

| 预设 | 请求方式 |
| --- | --- |
| [OpenAI](https://developers.openai.com/api/reference/resources/responses/methods/create) | Responses |
| [DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/) | Chat Completions |
| [OpenCode Go](https://opencode.ai/v2/docs/console/go/) | Chat Completions 兼容端点, 附稳定会话标识 |
| [Google AI Studio](https://ai.google.dev/gemini-api/docs/openai) | Gemini 的 OpenAI 兼容端点 |
| 自定义 OpenAI 兼容 | 填可信的 HTTPS 基础地址, 如服务商给出的 `https://example.com/v1` |

OpenCode Go 的工作区、套餐、模型与客户端用量限制仍适用. 自定义服务需支持标准 Chat Completions 的文本请求和响应结构. 仅在模型明确支持图像时启用 **模型支持图片**. PDF 文本选区可以作为普通文本发送.

**加载模型** 只发目录 GET, 不发问题、笔记或会话. [OpenCode Go](https://opencode.ai/v2/docs/console/go/#models) 使用独立公开目录, 不发送 Key, 因此可在填 Key 前加载; 目录不检查工作区权限. [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list)、[DeepSeek](https://api-docs.deepseek.com/zh-cn/api/list-models/) 和 [Google AI Studio](https://aistudio.google.com/docs/openai#list-models) 用各自的模型列表接口. 自定义服务用所填基础地址下的 `GET /models` 和 `data[].id` 返回格式. 列出模型不代表它支持聊天或图片, 也不代表当前 Key 有权调用; 加载不会更改已填 ID 或激活连接.

**重开后继续使用。** 在支持 SecretStorage 的 Obsidian（1.11.4 起），展开 **记住 API Key（可选）**，选择或新建一个 [Obsidian 密钥](https://docs.obsidian.md/plugins/guides/secret-storage)，再点 **启用 API 直连**。应用重开后，插件为当前连接读取该密钥；无需重填，也不会重发上次问题。插件只在设备本地保存关联名称，不将密钥写入插件配置、会话或导出。密钥本身由 Obsidian 存在当前设备和库的本地存储中，不是系统钥匙串。

仅填 **直连 API Key** 时仍为临时使用，不自动保存。关联按服务商、规范化 HTTPS 端点和身份标签隔离；同账号换模型可复用。**取消关联** 不删除 Obsidian 的共享密钥，当前连接仍可用。密钥被删除或不可读时，重新选择密钥或填写临时 Key。只在信任的设备使用直连；附带材料会发送给所选服务商。

默认自动模式使用 Fetch 真正 SSE 增量显示，响应详情标明实际传输。Fetch/CORS 不可用时可明确改为“原生整段”，不会为重试而自动重复 POST。停止按钮停止客户端等待，底层请求可能已抵达服务端。 没有收到可确认的结果时保留原问题与状态, 由用户决定是否另行重发. 自动行内补全在新后端默认关闭, 可以在设置中开启.

### API 直连思考档次

启用直连后, 在侧栏展开 **模型与选项** 并选择 **思考档次**.

- **OpenCode Go** 从 [Go 模型目录](https://opencode.ai/v2/docs/console/go/#models) 读取当前模型的档次. Chat Completions 发送 `reasoning_effort`, Responses 发送 `reasoning.effort`; 依据 [OpenCode Chat](https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/ai/src/protocols/openai-chat.ts) 和 [Responses](https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/ai/src/protocols/openai-responses.ts) 的字段.
- **DeepSeek** 读取 [模型目录](https://api-docs.deepseek.com/api/list-models/) 的 `effort.supported_levels`. 选择档次时发送 `thinking.type=enabled` 和 `reasoning_effort`; 对提供档次的模型, `none` 发送 `thinking.type=disabled`. 见 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/).
- **Google AI Studio** 按 [Google 思考档次表](https://aistudio.google.com/docs/thinking#thinking-levels) 和 [兼容接口说明](https://aistudio.google.com/docs/openai#thinking) 匹配具体聊天模型 ID, 不猜测 `*-latest` 别名. Gemini 3/4 使用兼容接口的 `extra_body.google.thinking_config.thinking_level`, Gemini 2.5 使用 `reasoning_effort`. 2.5 Pro 不提供关闭思考.

**使用服务商默认** 不发档次参数, 沿用原接口. 未确认的模型和其他直连预设显示默认, 不套用 Codex 的档次或 Fast. Go 和 DeepSeek 重连会核对目录; 如果原档次已不再提供, 重新选择可用档次或默认后再发. 已保存档次不因重输临时 Key 丢失.

### iPad 只显示“思考中”

“已启用”只表示直连配置已生效；“思考中”表示插件正在等回答。先看原问题下的 **操作详情**（失败或结果未知时显示），不要把没有正文的原请求反复提交。

如果使用 **响应传输 → 自动流式**，可以改为 **原生整段**，再点 **启用 API 直连**。用同一模型开新会话，发一条不附笔记或图片的短问题。这次对照只换传输；正文完成后才一次显示。若整段能回答，优先排查浏览器 Fetch、跨域预检和流式解析；两种都失败时，以原生请求返回的 HTTP 状态或操作详情核对权限、模型和端点。不要分享密钥或完整请求。

2026-11-10 用户确认使用 OpenCode Go 的 DeepSeek V4.1。Go 实时目录与[端点表](https://opencode.ai/docs/console/go/#endpoints)均显示 `deepseek-v4.1-flash` 使用 Chat Completions，选择该上游模型即可，保留 Go 预设。本机向这一推理端点发起不含密钥的浏览器式 `OPTIONS` 预检，返回 404，没有允许跨域的响应头；该路线上的 Fetch 无法提交带这些头的 POST。[Obsidian 原生请求](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl)不受浏览器 CORS 限制。若整段响应提示模型因地区策略不可用，按 [Go 的工作区说明](https://opencode.ai/docs/console/go/#enable-restricted-models)检查 `Settings → Privacy → Regions` 的 `Global` 是否获准；不因目录可见就认定有推理权限。

**同模型的 Windows 对照已通过。** 用户在 beta.15 使用 Go `deepseek-v4.1-flash`、原生整段完成了一轮真实请求。运行中和磁盘中的原操作均为 `completed`，实际模型及 `buffered` 一致，有服务商回执与完整正文（1693 个 UTF-16 码元、约 16.4 秒）。只读核对已有回执，没有发起新推理。随后按用户要求切回本机 Codex，确认 ChatGPT 登录与模型列表可用，Go 回答仍在原会话存储中。

**iPad 真机也已通过原生整段。** 用户提供的失败操作文案 `API 网络请求失败; 结果待核对, 未自动重发` 来自旧版 Fetch 流式分支，随后确认切换为原生整段确实可用。建议在 Go 的 iPad 配置保持 **原生整段**；改动后须点 **启用 API 直连**，启用结果会显示实际传输。新版区分流式未建立和原生整段错误，保留已收到的 HTTP 状态，不自动换传输或重发。密钥关联跨重启的验收是另一项，已有受控重开回归，待新包上 iPad 复验。

另在受控流中复现并修正：SSE `id` 重用时，旧解析器误丢正文和终态。按 [SSE 标准](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header)，`id` 是重连游标；只按协议事件序号去重。这项修复不影响原生整段，也不能让不允许跨域的端点支持 Fetch。

### beta.16 验收

- `npm run build`、`npm test`：531 项通过，1 项 opt-in 基准跳过。移动构建模拟重开后读取同一 Obsidian 密钥并保留整段模式，重开不发推理；另覆盖身份与端点隔离、取消关联、旧版临时 Key、响应解析和无自动重发。
- Windows 原生读回：密钥选择与临时掩码输入可见，本机 Codex、会话、修改记录和设置保留。真实设备上的 Go 整段调用和模拟重开证据分开记录；新版关联仍需在 iPad 重开一次确认。
- [Windows/Ubuntu CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/42772262362)、[发布流程](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/42772557066)通过。已发布 [beta.16](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.16)，7 项资产及两份 ZIP 读回，四份 Windows 插件文件与公开资产一致。独立桥保持 beta.15。

## Windows 本机 Agent

- **Codex** 使用 **启动本机 Codex** 复用已登录的后台 app-server. 同一区也提供临时 OpenAI API Key 登录.
- **Claude Code** 在 **Windows 本机 Agent** 中选用, 提供原生 `claude.exe` 的路径或留空查找 PATH. 先在 Claude Code 完成登录. 用官方 print 模式, 关闭内置工具、MCP 工具和会话落盘. [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-reference)
- **Antigravity** 在一个 Python 环境安装官方 `google-antigravity` SDK, 将该环境的 `python.exe` 填入 **Agent 运行入口**. 临时填 Google AI Studio Key 或用 Obsidian 启动环境中的 `GEMINI_API_KEY`. 后台调用本机 SDK, 工具只允许结束回答. 该入口使用 SDK 的密钥认证. [Antigravity SDK](https://antigravity.google/docs/sdk/overview)
- **DeepSeek Harness** 安装官方 `@deepseek-ai/dsh` CLI, 选择其 `dsh.exe` 或 `dsh` 的 Node 入口, npm 全局安装也可留空查找. 模型 ID 留空, 使用隔离 headless 配置的模型. 临时填 DeepSeek Key 或用 `DEEPSEEK_API_KEY`. 每次运行新建临时工作区与 DSH 配置根, 启动后确认工具拒绝策略已加载才通过 stdin 发送笔记. [DeepSeek Harness headless 文档](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/headless)

上述三个非 Codex 本机入口接收文字快照. API 直连及这三个入口复用插件内置数学规则、问答、引用、重发和确认式写回. 私有 `math-writing` 与当前库只读工具由 Codex 模式提供；支持函数工具的 API 可受限读取当前会话历史，不支持的后端采用宿主预算预取。 模型只有生成提案的权限, 笔记写入仍由当前 Obsidian 审核执行.

## 独立远程桥与切换

在任意客户端填写已有桥地址和配对密钥, 点击 **保存并连接**. 桥继续管理独立 Codex Agent, 见 [iPad 设置](ipad-setup.md). 新的直连和 Windows 本机 Agent 不要求升级桥. API 配置或本机 Agent 的会话按当前设备、服务商与端点或 Agent 入口隔离. 切回原连接会恢复对应历史. 同一端点与身份标签共用该设备历史；模型/协议和配置 ID 不作为新的历史归属。更换账号请使用不同身份标签，不把新账号悄悄并入旧历史。

升级保留已有客户端和桥状态文件. 回退插件程序后, 直连与非 Codex Agent 的独立记录保留在设备状态目录中, 再升回候选即可恢复. 普通 Codex 的桌面与远程记录沿用原存储和回退流程.

## 2.0.0-beta.8 验证

- `npm run build` 和 318 项测试通过. 使用受控目录与响应验证 DeepSeek 按模型读取档次并在修改预览请求发送 `max`, Gemini 的确切档次进入保存的会话操作与发出的请求. 单测验证关闭、默认、未知模型、无效档次及旧 Go 路径. 未使用真实 API Key 请求推理, 未在 iPad 真机测试.
- GitHub Actions 部分故障期间, Windows「数学」库先安装由 `55cabc38dd211b2321242a46d8f7671ca1ce40f3` 构建的本地校验包. 已安装版原生选择框使用隔离数据核对 DeepSeek、Gemini 和未知别名; 本机 Codex 恢复连接. 31 个会话、250 条消息、11 条修改记录、10 条写入计划、19 条发送操作及编辑器内容保持一致. 独立桥未改动.
- [Windows/Ubuntu CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41865681786) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41866742028) 均通过. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.8) 回读核对 7 个资产与两个 ZIP, 四个 Windows 安装程序文件与公开资产逐字节一致. 最新正式版仍为 1.1.0.

## 2.0.0-beta.7 验证

- 构建与 314 项测试通过. 移动构建走通加载目录、选择模型、保存档次、按已保存档次发出受控请求、重连后校验过期档次、恢复服务商默认. 对 Chat Completions 和 Responses 的字段使用独立模拟请求校验; 未发起真实 Key 推理.
- Windows 原生隔离探针使用 Go 的实时公开目录渲染实际侧栏控件. GLM-5.3-Flash 显示默认、low、high、max; DeepSeek V4 Pro 显示默认、high、max; 未接入的 Claude Haiku 5.5 只显示服务商默认. 未进行 iPad 真机验证.
- Windows「数学」库已从 beta.6 升级. 已安装程序使用独立模型数据渲染并保留 `max` 选择; 实际设置读取 28 个 Go 模型, 缺 Key 时保留表单. 本机 Codex 恢复连接; 30 个会话、246 条消息、11 条修改记录、10 条写入计划、18 条发送操作和编辑器内容保持一致. 独立桥未改动.
- [Windows/Ubuntu CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41792012156) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41792184144) 通过. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.7) 对应 `be91c4e840a19e6d1e846661c6c16d311e031487`. 7 个公开资产、两个 ZIP 的成员及 Windows 四个安装文件均通过公开发布回读. 最新正式版仍为 1.1.0.

## 2.0.0-beta.6 验证

- beta.5 的设置回归在成功和失败两条路径都可复现: 成功时目录被清空; 缺 Key 失败时连所选服务商和模型 ID 也被重置. 两条回归在修复前均失败.
- 修复后用移动构建与受控请求验证: 缺 Key 或切换受阻时保留所选模型和已填表单, 原地重试成功, 选中模型可继续生成修改预览, 密钥不落盘. Windows 原生隔离探针实读 OpenCode Go 目录的 28 项, 以合成 Key 和受控激活结果验证失败、重试及成功提示; 360px 和 640px 容器无横向溢出. 未进行真实 Key 推理或 iPad 真机复验.
- Windows「数学」库从 beta.5 升级到 beta.6 后, 在实际安装版设置中读取 Go 目录的 28 项并选择 `glm-5.3-flash`. 不填 Key 点击启用时显示错误, 目录、所选模型和原连接都保留. 原有 30 个会话、246 条消息、11 条修改记录、10 条写入计划、18 条发送操作与编辑器缓冲区一致; 本机 Codex 恢复连接, 独立桥未改动.
- [Windows/Ubuntu CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41789674581) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41789804944) 通过. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.6) 绑定 `47a2578af498ddb64d242012a5c14b6426a09aa3`. 匿名下载校验了 7 个公开资产及两个 ZIP 的白名单成员; Windows 的四个程序文件与公开资产逐字节相同. 最新正式版仍为 1.1.0.

## 2.0.0-beta.5 验证

- Node 24 上运行 `npm run build` 和 `npm test`, 310 项通过. 目录测试覆盖五种预设、认证和错误映射. 移动构建在受控请求下走通目录读取、选模型、用选中 ID 发送和确认写入; 切换服务商或 Key 后忽略旧响应, 无目录时仍能手填.
- Windows Obsidian 用一次性探针实际请求 OpenCode Go 的公开目录, 读到 28 个模型, 并用原生控件选择 `glm-5.3-flash`. 设置行在 360px 和 640px 容器下均无横向溢出. 该探针没有调用推理、替换日常安装或改动远程桥.
- 其他服务商的真实 Key 目录与 iPad 真机未实测. 模型目录不写入状态; 已有直连配置和手填模型 ID 沿用 beta.4 的存储格式.
- Windows「数学」库已从 beta.4 安装并重载 beta.5. 已安装设置从 Go 公开目录读取 28 个模型并选中 `glm-5.3-flash`, 未提交推理. 本机 Codex 已恢复连接, 可见 8 个模型和已启用的 math-writing. 30 个会话、246 条消息、11 条修改记录、10 条写入计划、18 条发送操作和打开的编辑器内容均保持一致. 独立桥未改动.
- [Windows/Ubuntu CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41776341451) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41776443977) 通过. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.5) 绑定 `3154c48d98153356ccb68767d54320aa9a3a806c`. 匿名下载校验了 7 个公开资产, 插件与桥 ZIP 分别含 4 和 17 个白名单文件; Windows 安装的四个程序文件与公开资产逐字节相同. 最新正式版仍为 1.1.0.

## 2.0.0-beta.4 验证

- `npm run build` 与 `npm test` 通过. 移动构建使用模拟 HTTPS 请求复验 DeepSeek 选段改稿、确认前零写入、确认写入、服务商切换、重载恢复、密钥不落盘和网络结果未知时不重发. 单测核对五个直连预设的请求结构.
- Windows 使用真实 Claude Code 2.1.318 调用一次回环 mock, 收到正文且模型请求包含零工具. DeepSeek Harness 0.2.1-rc.5 的真实 Windows 进程先加载工具拦截, 空 stdin 被拒绝, 没有提交推理. Antigravity SDK 0.1.23 的真实 Windows Python 环境成功构造只允许 `FINISH` 的配置.
- 以上不含实际服务商密钥问答或 iPad 真机测试. 验证使用原创样本、合成密钥和隔离目录.
- 2026-11-04 Windows「数学」库安装 beta.4 后重新加载. 原生设置可见 API 预设、Windows Agent、本机 Codex 和桥入口. 本机已有登录读取到 8 个模型并发现 math-writing. 30 个会话和 246 条消息的历史、设置、笔记关联、18 条发送事务及打开的编辑器内容保持一致. 11 条修改记录和 10 条写入计划的内容在校正 JSON 字段顺序后匹配安装前的摘要. 活动临时线程与工作提示词哈希按原有重连行为清理. Obsidian 捕获日志中没有本插件相关错误.
- GitHub 的 [Windows/Ubuntu 检查](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41755562570) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41755817625) 成功. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.4) 绑定 `ca4304b571cbbaaeb3d00a87673251eb01a0a2e2`. 匿名下载 7 个文件核对 GitHub 摘要, 两个 ZIP 的 4/17 个成员匹配构建清单. Windows 四个安装文件与公开资产逐字节一致.

## 流式与结果协议依据

本版使用 [OpenAI SSE](https://developers.openai.com/api/docs/guides/streaming-responses) 与 [Responses 终态事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[DeepSeek Chat SSE/finish_reason/usage](https://api-docs.deepseek.com/api/create-chat-completion/)、[Gemini OpenAI 兼容流式](https://aistudio.google.com/docs/openai#streaming) 及 [Go 协议端点](https://opencode.ai/v2/docs/console/go/)。帧拆分遵循 [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)。[Obsidian 官方 requestUrl 类型](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) 没有 ReadableStream 接口，因此原生路径明确标为 buffered；这不代表设备 Fetch 一定可达某服务商。服务端截断、拒绝、未知与网络断流分别保留实际结果，不把请求 ID 当作可恢复接口，也不静默启用存储。
