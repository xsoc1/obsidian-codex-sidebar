# Codex Sidebar

Windows 桌面 Obsidian 插件, 使用本机 Codex 登录. 点击 Obsidian 左侧工具栏的机器人图标, 打开或收起右侧聊天栏.

[GitHub 源码仓库](https://github.com/xsoc1/obsidian-codex-sidebar)

## 使用

- 直接输入问题, Enter 发送, Shift+Enter 换行. 回复支持 Markdown 和数学公式, 可以停止或复制.
- 在编辑、实时预览或阅读模式选中文字, 上下文卡片自动更新. 点击 `解释选区` 或 `检查证明` 会自动组织问题并发送.
- 点击 `捕获当前位置` 附带编辑光标附近或当前阅读视口的 Markdown. 卡片可展开检查源文本, 勾选是否附带到普通问题.
- `新会话` 创建独立会话. 下拉框切换本插件的历史会话. 会话保存在插件 `data.json` 及 Codex 自身的会话存储中.
- 设置里的 Codex 路径留空时从 PATH 查找 `codex.exe`. 模型留空时沿用本机 Codex 配置. 更改后点击重连.

## 边界

- 初版处理 Markdown 笔记. 阅读选区携带对应的完整源块, 保留 LaTeX; 无法映射时标明 `渲染文本`. 不承诺精确源字符对应.
- 自动捕获不自动发送. 快捷动作自动构造 prompt; 用户发送后才调用 Codex.
- 此插件运行自己的 Codex app-server 并复用登录. 历史列表为本插件创建的会话, 不直接接管 Codex 桌面应用正在运行的聊天.
- 问答采用只读沙箱. Codex 的批准请求通过窗口显示. 初版没有将答案写回笔记的按钮.
- 收起面板保留连接与当前回复. 禁用插件或退出 Obsidian 会关闭本插件创建的子进程.
- 未验证 PDF/OCR、Canvas、手机及其他操作系统.

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

## 本机验收 (2026-10-11)

Obsidian 1.14.4 + codex-cli 0.162.0-alpha.17.2. `npm run build` 和 8 项测试通过. 已验证真实 ChatGPT 登录推理、回复公式渲染、左侧开关、停止、重载后同一会话续聊、编辑选区、阅读公式源块、自动选区捕获及当前阅读视口. 源块中保留的 LaTeX 已通过 Codex 公开 thread/read 接口回读核对. 模型继承本机配置, 本次实际为 gpt-6.1-sol.

此验收不包含 PDF、OCR、全部多窗/嵌入组合或特权执行批准. 暂未发布到 Obsidian 社区目录.
