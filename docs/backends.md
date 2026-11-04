# 选择连接方式

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

Key 保留在本次插件运行的内存中. 切换后端或重载后需重新输入. API 直连需要在客户端使用长期密钥, 适用于自己信任的设备和服务. 请求附带选区、来源快照和有限的对话历史, 服务商按其数据条款处理. 官方对密钥的安全建议见 [OpenAI API 认证](https://developers.openai.com/api/reference/overview#authentication).

直接请求在收到完整响应后显示正文. 停止按钮停止客户端等待, 底层请求可能已抵达服务端. 没有收到可确认的结果时保留原问题与状态, 由用户决定是否另行重发. API 模式使用设置中的模型 ID, 首版不映射各厂商的 Fast 或思考档次. 自动行内补全在新后端默认关闭, 可以在设置中开启.

## Windows 本机 Agent

- **Codex** 使用 **启动本机 Codex** 复用已登录的后台 app-server. 同一区也提供临时 OpenAI API Key 登录.
- **Claude Code** 在 **Windows 本机 Agent** 中选用, 提供原生 `claude.exe` 的路径或留空查找 PATH. 先在 Claude Code 完成登录. 用官方 print 模式, 关闭内置工具、MCP 工具和会话落盘. [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-reference)
- **Antigravity** 在一个 Python 环境安装官方 `google-antigravity` SDK, 将该环境的 `python.exe` 填入 **Agent 运行入口**. 临时填 Google AI Studio Key 或用 Obsidian 启动环境中的 `GEMINI_API_KEY`. 后台调用本机 SDK, 工具只允许结束回答. 该入口使用 SDK 的密钥认证. [Antigravity SDK](https://antigravity.google/docs/sdk/overview)
- **DeepSeek Harness** 安装官方 `@deepseek-ai/dsh` CLI, 选择其 `dsh.exe` 或 `dsh` 的 Node 入口, npm 全局安装也可留空查找. 模型 ID 留空, 使用隔离 headless 配置的模型. 临时填 DeepSeek Key 或用 `DEEPSEEK_API_KEY`. 每次运行新建临时工作区与 DSH 配置根, 启动后确认工具拒绝策略已加载才通过 stdin 发送笔记. [DeepSeek Harness headless 文档](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/headless)

上述三个非 Codex 本机入口接收文字快照. API 直连及这三个入口复用插件内置数学规则、问答、引用、重发和确认式写回. 当前库按需补读、私有 `math-writing` 技能和历史分页读取由 Codex 模式提供. 模型只有生成提案的权限, 笔记写入仍由当前 Obsidian 审核执行.

## 独立远程桥与切换

在任意客户端填写已有桥地址和配对密钥, 点击 **保存并连接**. 桥继续管理独立 Codex Agent, 见 [iPad 设置](ipad-setup.md). 新的直连和 Windows 本机 Agent 不要求升级桥. API 配置或本机 Agent 的会话按当前设备、服务商与端点或 Agent 入口隔离. 切回原连接会恢复对应历史. 同一端点更换 API Key 仍打开该端点的历史, 换账号时可先新建会话.

升级保留已有客户端和桥状态文件. 回退插件程序后, 直连与非 Codex Agent 的独立记录保留在设备状态目录中, 再升回候选即可恢复. 普通 Codex 的桌面与远程记录沿用原存储和回退流程.

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
