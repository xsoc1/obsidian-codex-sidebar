# 0.10.0 范围、选区与折叠验证

基线为现有 0.9.0 记录提交 3bc4b56, 源/开发树开始均干净. 基线 build 与 81 项测试通过. 用户本轮要求 AI 自己选择修改范围、选中笔记时侧边显示选区、Windows 也能折叠. Codex 保持只读, 普通轮次仍 text+math-writing, 没有新文件工具、技能路径、远程权限或框架.

- `npm run build` 与 89 项 `npm test` 通过. 覆盖 AI 选择选区以外的唯一子段、只改实际子段、空/缺失/重复/越窗原文拒绝、解析范围的只读检查、候选窗口截断、旧 v1 原字节保留/v2 迁移、日志范围篡改拒绝、原模式重发、选择卡片原始公式/截断/附带状态、输入焦点保护、清除在途捕获、桌面折叠节点/偏好和原有功能. 初次新增捕获夹具缺 getViewType, 补足夹具后通过, 不算产品故障.
- `CODEX_EDIT_SCOPE=ai CODEX_EDIT_TEST_CLI=<installed-cli> npx tsx scripts/edit-live.ts`: 一次真正的隐藏 ephemeral Codex 请求, gpt-6.1-sol/low/default, read-only/never, math-writing 声明 0.2.0, 两输入. 只选原创短稿开头说明, 模型自行选择后面计算的精确原文并仅改最后 e→2e. completed 后 schema 与唯一匹配通过; 内存 host 验证预览零写入、重复确认去重、安全撤销、陈旧拒绝. 此项是实际模型、内存写入, 不冒充原生完整侧栏.
- 原生 Windows 临时 SDK 插件重放上一项真实结果: 实际 ContextCapture/MarkdownView/Editor、选择预览组件、桌面四折叠区、render_edit 按钮、ConfirmedWriter/ObsidianWriteHost. 检查选区/源 LaTeX、阅读渲染选区对应原文、截断及未附带提示, 选区在控制区外; 含未保存草稿的实际确认/双击/编辑器 undo-redo/安全撤销/后续编辑冲突均通过. 清理后探针/测试笔记不存在, 日常仍为 0.9.0、mobile=false、EmulateMobile=null. 组件根节点离屏隐藏以免干扰日常窗口, 不宣称完整主侧栏可见性已原生验收.
- `scripts/check-sidebar-layout.mjs`: 新鲜无窗口 Edge/public app.css, 8 组移动尺寸/主题与 4 组 Windows 窄栏尺寸/主题. 实际 sidebar_panel/EditOptions/SelectionPreview 模块显示选区, 折叠上下文时卡片仍可见、原文保留、手动折叠不会被刷新打开, 中文草稿和焦点保留, 无横向溢出及自有悬停属性. Desktop 320×620 时有选区卡、发送展开仍保留约 130px 回答区; 可收起发送扩展回答区. 未动 Obsidian 全局移动仿真. Headless 不是 iPad 真机.

新增范围模块不信任模型自报偏移; 仅从宿主已冻结窗口唯一匹配 original, 在生成和确认阶段都重查实际范围只读性. 关闭插件后笔记保持普通 Markdown. 默认 AI 窗口可能包含原选区以外文字, 明确标注最多 24000 字符, 不自动上传整个 vault.

2026-10-16 用户明确授权“安装 Windows 并发布 GitHub”. 先在 Git 外备份原四个构建文件、data.json 及设备本地学习/修改/折叠状态, 仅替换四个文件并重载到 0.10.0. 原三个会话 ID/消息数组、活动会话、具体设置 (仅迁移内置指令)、学习数据、修改数据 v2 迁移及 v1 原字节均匹配; 实际引导返回七个模型和 math-writing 0.2.0.

已在日常 Windows 的真实主侧栏走通原创临时笔记: 原生编辑器选中开头说明, 来源 keyup 自动捕获; 选区卡片在收起的上下文区外可见, 转入输入框后快照不变. 真实发送按钮提交隐藏 gpt-6.1-sol/low/default 请求, completed 后模型自行选择后面的证明原文, 最终全文仅 e→2e. 预览期间文件和编辑器零修改; 实际主侧栏“确认写入此文件”连续点击两次只产生一次写入, “安全撤销本次修改”恢复原文. 另核对原始矩阵 LaTeX、选区手动收起、四个桌面折叠区、折叠保留草稿以及关闭/重开侧栏恢复偏好, 自有悬停属性为零. 原生截图已实际查看. 初始验收脚本误用插件 ID 作为 view type, 改为真实 codex-sidebar-view 后继续通过, 未因此修改产品代码.

测试后移除自建会话/笔记/修改日志, 恢复原设置、选区和折叠偏好、字节相同的学习数据, 再重载. 未读取认证文件或改全局 Codex/技能/配对/桥服务/真实课程材料. 原生日志留有 RenderingCancelledException, 无插件帧, 不宣称运行时零错误. 本轮未做 iPad 真机、全部阅读嵌入组合、原生多主题或手动 IME 验收. GitHub 资产发布校验另行记录; 使用说明/迁移见 [note-edits.md](note-edits.md).
