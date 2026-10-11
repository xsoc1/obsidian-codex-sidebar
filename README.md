# Codex Sidebar

Windows 桌面 Obsidian 插件, 使用本机 Codex 登录. 点击 Obsidian 左侧工具栏的机器人图标, 打开或收起右侧聊天栏.

[GitHub 源码仓库](https://github.com/xsoc1/obsidian-codex-sidebar)

## 使用

- 直接输入问题, Enter 发送, Shift+Enter 换行. 回复支持 Markdown 和数学公式, 可以停止或复制.
- 在编辑、实时预览或阅读模式选中文字, 上下文卡片自动更新. 点击 `解释选区` 或 `检查证明` 会自动组织问题并发送.
- 点击 `捕获当前位置` 附带编辑光标附近或当前阅读视口的 Markdown. 卡片可展开检查源文本, 勾选是否附带到普通问题.
- `新会话` 创建独立会话. 下拉框切换本插件的历史会话. 会话保存在插件 `data.json` 及 Codex 自身的会话存储中.
- 消息区下方持续显示 `思考中 / 正在回答 / 正在运行工具` 和耗时. 如果后端返回思考摘要, 可以展开查看.
- 输入框上方选择模型、思考档次及 `Fast`. 选项从本机 Codex 的 `model/list` 读取, 下一次发送生效, 回复进行中不可更改. 模型选 `本机默认` 时读取本机模型与思考配置; 显式选择模型后, `默认` 档次使用该模型返回的默认值.
- `Fast` 依据模型报告的服务档次发送请求, 关闭时显式请求标准速度. Fast 可能增加用量, 是否有访问权限由后端决定, 失败会显示错误.
- `上下文占用` 开关显示或隐藏后端最近一次请求的 token 数、窗口大小和占用估计. 显示的是最近请求, 不把整个会话累计消耗作为占用; 未报告窗口时不编造百分比, 重载后的历史值会保留.
- 默认工作提示词说明 Obsidian 阅读、解释、证明检查与研究任务, 要求公式使用 `$...$` 与 `$$...$$`, 保留 LaTeX, 并使用可直接复制到笔记的 Markdown. 在插件设置中可以编辑或恢复默认, 修改后下一次发送会更新当前会话.
- 设置里的 Codex 路径留空时从 PATH 查找 `codex.exe`. 路径更改后点击重连.

## 边界

- 初版处理 Markdown 笔记. 阅读选区携带对应的完整源块, 保留 LaTeX; 无法映射时标明 `渲染文本`. 不承诺精确源字符对应.
- 自动捕获不自动发送. 快捷动作自动构造 prompt; 用户发送后才调用 Codex.
- 此插件运行自己的 Codex app-server 并复用登录. 历史列表为本插件创建的会话, 不直接接管 Codex 桌面应用正在运行的聊天.
- 问答采用只读沙箱. Codex 的批准请求通过窗口显示. 初版没有将答案写回笔记的按钮.
- 收起面板保留连接与当前回复. 禁用插件或退出 Obsidian 会关闭本插件创建的子进程.
- 未验证 PDF/OCR、Canvas、手机及其他操作系统.
- 思考摘要只展示后端实际返回的摘要. 没有摘要时仍显示思考状态, 不推测或伪造内部推理.

## 开发与安装

```powershell
git clone https://github.com/xsoc1/obsidian-codex-sidebar.git
cd obsidian-codex-sidebar
npm ci
npm run build
npm test
```

将 `manifest.json`, `main.js`, `main.js.map`, `styles.css` 复制到 vault 的 `.obsidian/plugins/codex-sidebar/`, 在社区插件中启用. 不覆盖已有 `data.json`.

仓库跟踪源码、测试与依赖锁文件. 构建产物、依赖目录、本机路径、环境文件及聊天记录不纳入版本控制.

协议参考: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Obsidian API](https://github.com/obsidianmd/obsidian-api).

工作提示词在创建/恢复会话时传入 `developerInstructions`, 并通过官方 `thread/inject_items` 以 developer 消息加入模型可见历史. 提示词发生变化或上下文压缩后再次注入, 保留 Codex 基础工具指令和会话 ID. 不修改全局 Codex 配置或 vault 的 AGENTS.md. 本机协议需支持 `thread/inject_items`; 当前验收使用下述 CLI 版本.

## 本机验收 (2026-10-11)

0.2.0: Obsidian 1.14.4 + codex-cli 0.162.0-alpha.17.2. `npm run build` 与 12 项测试通过. 实际原生界面验证了动态模型/档次列表、持续思考提示、Fast 开关、用量显示开关、重载保留设置和同一会话 ID. 真实请求覆盖 gpt-6.1-sol 的 high/low + priority 和 gpt-6-luna 的 medium + default; `thread/read` 核对了切换后的模型与档次. 改动后的工作提示词通过自动注入及真实回复中的测试标记核对. 回复中的 `$` 数学公式已由 Obsidian MathJax 渲染.

0.1.0 的初版验收覆盖真实 ChatGPT 登录推理、公式渲染、左侧开关、停止、重载续聊、编辑选区、阅读公式源块、自动捕获及当前阅读视口; 原始 LaTeX 通过公开 `thread/read` 接口回读核对.

本轮简单问题没有返回实际思考摘要, 摘要流与折叠展示另以模拟协议事件检查. 此验收不包含上下文压缩的完整长会话、PDF、OCR、全部多窗/嵌入组合或特权执行批准. 暂未发布到 Obsidian 社区目录.
