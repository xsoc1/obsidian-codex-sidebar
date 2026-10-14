# 工作台验证记录

日期: 2026-10-14. 开发起点为干净的 codex/initial HEAD 82209ad, 版本 0.6.2. 本轮代码为隔离分支 codex/study-workbench 的未发布 0.7.0. 未回退 d022becc, 未推送、发布、覆盖日常安装或真实课程笔记.

## 构建与受控检查

基线 npm run build、npm test 通过, 41 项. 新版 TypeScript/esbuild 与 56 项测试通过, 类型检查包括 opt-in 实测脚本. 新测试与回归覆盖模型/effort/Fast、引用/分支/快照、缺失技能、公式/截断、移动入口无 Node/Electron、双设备桥隔离、任务恢复、练习/分层提示/揭示、其他正确路线、补全取消/恢复、写入前无修改、去重/陈旧/撤销、迟到清除竞争、存储失败与 schema 兼容.

这是 fixture/协议/模块证据, 不等同于模型或设备测试. 配额失败保持原数据; pending 写入期间清除被拒绝. 非空旧学习 schema 不作推测性迁移; 本轮早期 SchemaVersion 字段兼容规范化为 schemaVersion, 记录内容/设备 ID 保留.

## 真实模型

实际使用 codex-cli 0.162.0-alpha.17.2, gpt-6.1-sol / low / default, ephemeral=true、path=null、read-only、approvalPolicy=never. 当前 cwd 的 skills/list(forceReload) 发现 math-writing, 安装声明实际为 0.2.0, 每轮两项输入含该技能.

study-live.ts 完成原始矩阵段解释、相近练习、渐进提示、非标准矩阵乘法尝试及 correct 反馈、完整样章、提案、陈旧拒绝、新预览确认与撤销. 该脚本的写入宿主是内存 fixture, 不能称为 Obsidian 写入验收.

study-remote-live.ts 使用新临时目录、随机配对、独立回环测试桥, 实际启动两个不同 PID 的 CLI. A 获得并通过 schema 校验的练习, B 没有 A 的状态/轮次, 两者共享本机登录但进程与记录隔离. 客户端刻意不保存 turn ID, 后续 GET /state 恢复原 Task/Source、final_answer 和 completed. 这是未保存确认的恢复测试, 不是 iPad 或实际网络切换. B 有自己的非聊天启动通知; 不把“启动事件数非零”误判为串会话.

## 原生 Windows

Obsidian 1.14.4 (installer 1.13.7), 独立临时 vault, 只使用原创 Lie-mini、Analysis-mini 与测试新稿. 本次确认按钮由测试代理执行, 不表示用户审定了数学内容.

- 选段 → 固定 → 真实解释 → 相近练习 → 矩阵乘法尝试 → 提示/真实反馈 → 完整答案 → 返回正文实际走通. 模型接受未按参考双线性路线书写的正确直接乘法.
- 作答框聚焦暂停补全, 原 preference 保持 true, 离开恢复. CDP imeSetComposition/insertText 触发 compositionstart/end, 中文文本保持, 未用 Enter/Tab 接受补全. 这是原生窗口中的 CDP 合成输入, 未验证硬件中文输入法.
- 样章正常完成后显示目标/差异与渲染, 确认前目标不存在. 实际 CDP 鼠标点击确认后, 当前客户端创建文件并回读, journal=applied.
- 补充提案生成后修改当前编辑器, 确认拒绝陈旧内容并保留后续编辑. 重新捕获/生成后再次鼠标确认采用, 后续编辑仍在. Editor.undo/redo 均与宿主 Before/After 一致; 工作台安全撤销回读一致, journal=undone.
- 插件多次重载保留固定段、尝试、提示、任务与三类写回收据. 0.7.0 与 schemaVersion=1 加载实测成功.
- 新建阅读页的选段返回阅读/源块, 原始 epsilon LaTeX 与版本哈希保留; 焦点在分析页而固定目标仍是先前新稿. 原生 MathJax 4.1.3 解析原创两篇、新稿、练习与反馈中的 131 个公式, 错误 0.
- 300 CSS px 侧栏与亮/暗主题代表画面检查; 自有 input/select/textarea/button 无 title/aria-label 悬停来源, 原生标签仍可访问. 数学长式允许横向滚动, 未做全篇/全主题/全部字号验收.

临时窗口曾显示 isVisible=true 但 document.hidden=true, 旧阅读页动画/绘制停留. 测试中临时关闭该窗口后台节流并最小化/恢复, 新阅读页正常渲染; 随后恢复节流. 未把旧截图当新阅读验收, 未修改产品去绕过应用可见性. 该环境现象不能据此归因于插件. 最终 dev:errors 检查另见私有本机记录.

## 修复与剩余范围

导出 JSON、练习/解答 Markdown 与 LaTeX 源码通过原生工作台按钮打开可复制内容, 实际核对 schema、题面/答案、稳定 ID、标题与公式. 清除后练习、任务与收据均为零, 已创建正文仍存在. 下载管理器落盘与移动保存行为未冒充已验收.

真实测试暴露并修复: JSON 双重转义; 已有末尾 ID 与宿主 ID 相邻; 中途说明与最终 JSON 混合; 面板未接到常规刷新. 最终输出按阶段处理并保留原会话. 另避免练习 JSON 提前展开答案; 原始查看/复制记为揭示, 反馈编辑重发新建尝试.

生成内容仅接受惰性的数学 Markdown, 拒绝代码围栏、HTML、脚本 URL 与自动嵌入, 防止社区代码块处理器在预览执行. 普通既有聊天/源笔记行为不被全局改写.

未验收: iPad 0.7.0 真机、触控/软键盘、锁屏/网络切换、移动下载、硬件中文输入法; 长时间容量压力、所有插件组合与 TeX 实际编译. 0.6.2 此前 iPad 基础问答通过不能转算成本工作台通过. 静态/公式解析与有限模型例子不认证整篇数学, 不证明教学效果或学生已掌握.

私有样本响应、截图、缓存/收据和完整本机路径仅在仓库外临时目录, 指针记在忽略的 LOCAL_DEV.md. 源码只交付原创样本、测试、协议与指南.

清理: 测试插件禁用, 临时窗口关闭并移除其 vault 登记, 原创两篇在测试前后 SHA-256 一致. 日常安装四个文件与 0.6.2 基线哈希全部一致, 原源目录仍在 codex/initial 且工作区干净. 最终测试 vault 的 dev:errors 没有捕获错误, 此次结果不认证其他 vault 或所有运行路径零错误.
