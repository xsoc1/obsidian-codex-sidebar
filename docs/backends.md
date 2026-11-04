# 选择连接方式

## API 直连

打开 Codex Sidebar 设置, 在 **API 直连** 选择服务商, 填写控制台中的模型 ID 和 **直连 API Key**, 点击 **启用 API 直连**. 用一个短问题确认模型权限. Windows、iPad 和其他可以安装插件的端使用相同入口, 设备需要能通过 HTTPS 访问所选服务商.

| 预设 | 请求方式 |
| --- | --- |
| [OpenAI](https://developers.openai.com/api/reference/resources/responses/methods/create) | Responses |
| [DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/) | Chat Completions |
| [OpenCode Go](https://opencode.ai/v2/docs/console/go/) | Chat Completions 兼容端点, 附稳定会话标识 |
| [Google AI Studio](https://ai.google.dev/gemini-api/docs/openai) | Gemini 的 OpenAI 兼容端点 |
| 自定义 OpenAI 兼容 | 填可信的 HTTPS 基础地址, 如服务商给出的 `https://example.com/v1` |

OpenCode Go 的工作区、套餐、模型与客户端用量限制仍适用. 自定义服务需支持标准 Chat Completions 的文本请求和响应结构. 仅在模型明确支持图像时启用 **模型支持图片**. PDF 文本选区可以作为普通文本发送.

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

## 2.0.0-beta.4 验证

- `npm run build` 与 `npm test` 通过. 移动构建使用模拟 HTTPS 请求复验 DeepSeek 选段改稿、确认前零写入、确认写入、服务商切换、重载恢复、密钥不落盘和网络结果未知时不重发. 单测核对五个直连预设的请求结构.
- Windows 使用真实 Claude Code 2.1.318 调用一次回环 mock, 收到正文且模型请求包含零工具. DeepSeek Harness 0.2.1-rc.5 的真实 Windows 进程先加载工具拦截, 空 stdin 被拒绝, 没有提交推理. Antigravity SDK 0.1.23 的真实 Windows Python 环境成功构造只允许 `FINISH` 的配置.
- 以上不含实际服务商密钥问答或 iPad 真机测试. 验证使用原创样本、合成密钥和隔离目录.
- 2026-11-04 Windows「数学」库安装 beta.4 后重新加载. 原生设置可见 API 预设、Windows Agent、本机 Codex 和桥入口. 本机已有登录读取到 8 个模型并发现 math-writing. 30 个会话和 246 条消息的历史、设置、笔记关联、18 条发送事务及打开的编辑器内容保持一致. 11 条修改记录和 10 条写入计划的内容在校正 JSON 字段顺序后匹配安装前的摘要. 活动临时线程与工作提示词哈希按原有重连行为清理. Obsidian 捕获日志中没有本插件相关错误.
- GitHub 的 [Windows/Ubuntu 检查](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41755562570) 和 [发布任务](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41755817625) 成功. [公开预发布](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.4) 绑定 `ca4304b571cbbaaeb3d00a87673251eb01a0a2e2`. 匿名下载 7 个文件核对 GitHub 摘要, 两个 ZIP 的 4/17 个成员匹配构建清单. Windows 四个安装文件与公开资产逐字节一致.
