# 普通聊天确认改稿验证 (2026-10-15)

基线为当前 0.8.0 文档提交 85c12a7, 不回退历史 d022becc. 开始时开发工作树干净; 源工作树既有移动仿真修复 AGENTS 增量保留. 基线 build 和 71 项 fixture 测试通过.

## 实际执行

- `npm run build`: TypeScript (包括 opt-in 验证脚本) 与移动入口/独立桥打包通过.
- `npm test`: 81 项 fixture 检查通过, 包含原功能和普通移动入口的 composer → text+skill → 最终回答 → 本地提案 → 确认/撤销, 私有基线不进入模型/远程状态, 原快照重发, 仅问答/回答引用降级、技能缺失、只读/越界/渲染定位/截断/陈旧拒绝, 中断/非法结构, 清除迟到、设备隔离、记录恢复、重复确认/日志恢复、删除范围、quota 和原数学修改规则迁移.
- `CODEX_EDIT_TEST_CLI=<installed-cli> npx tsx scripts/edit-live.ts`: 真实本机登录, 独立隐藏 ephemeral app-server, read-only/never, gpt-6.1-sol/low/default, 每轮 text+math-writing 两项. 技能声明 0.2.0. 原创 Edit-mini 段落故意把 [h,e]=2e 写成 e; 真实 completed 最终 JSON 通过 schema, 仅修正系数, 不改邻段. 内存 host 检查预览零写入、去重确认、安全撤销与陈旧拒绝. 这项不是原生文件写入或一般数学正确性认证. 首次脚本把 undone 后重复 confirm 误当成应抛错, 实际实现按既定幂等约定无动作; 修正测试为新提案加后续编辑后, 新一次真实请求通过. 不将首次 harness 失败描述为模型或插件故障.
- 原生 Windows Obsidian SDK 临时插件: 用上一项真实输出重放到原创临时笔记, 使用实际 ContextCapture、MarkdownView、Editor、ObsidianWriteHost、render_edit 按钮与本地控制器. 捕获时磁盘与编辑器内容不同, 证实含未保存草稿. 原生确认按钮前零写入, 双击仅写一次, 保留邻段/草稿; Editor.undo/redo 和侧栏安全撤销按钮实际通过. 后续编辑再确认进入 conflict, 原文不被覆盖. 自有提案字段无 title/aria-label 悬停说明. 这是原生组件和文件路径验证, 模型请求在独立脚本中执行; 未将两者冒充整套日常插件 UI 端到端验收.
- `CODEX_LAYOUT_BROWSER=<headless-edge> CODEX_LAYOUT_APP_CSS=<public-app.css> node scripts/check-sidebar-layout.mjs`: 新鲜无窗口浏览器 profile, 实际 EditOptions 模块与现有公开样式 fixture, 320/350/450px、340/519/620/720px、深/浅主题. 四个控制区默认折叠, 新增修改选项也折叠, 标签关联、草稿/选项保留、焦点恢复、发送可达、无横向溢出和无悬停属性通过. 未开启 Obsidian 全局 EmulateMobile; 不能据此声称 iPad 真机通过.

原生验证未替换日常 0.6.2, 未改真实课程笔记、认证文件、全局 Codex 配置、配对和网络入口. 临时插件卸载, 测试笔记删除, 原活动叶恢复, 数学窗口 mobile=false、EmulateMobile=null. 初次清理时脏编辑器关闭后的异步保存重建了一次临时笔记; 发现后删除并延迟回读确认不存在, 测试脚本相应先等关闭保存再删除. 不隐瞒或把它算成零副作用.

修正后的原生探针已重新完整执行, 同样通过确认/撤销/冲突, 清理后 API 返回 scratch=[]、probes=[], 日常版本仍 0.6.2, 全局移动仿真保持关闭.

## 日常安装后的真实主侧栏闭环

用户明确选择“安装 Windows 并发布 GitHub”后, 备份旧四文件/data.json/运行时状态, 只替换四个构建文件并 plugin:reload. 0.9.0 的改稿与工作台模块成功加载, 三段原会话的 ID/消息数组、具体设置 (除有意迁移的默认提示词)、当前会话和连接模式比对一致.

在实际日常主侧栏新建一段测试会话, 只使用原创微型李代数短稿和命名临时笔记. 原聊天输入框自动变为“生成修改预览”, 真正发送到隐藏本机 app-server, gpt-6.1-sol/low/default + math-writing, 收到 completed 最终回答并自动生成预览. 确认前编辑器逐字未变; 实际主侧栏“确认写入此文件”双击后采用, 系数确实从 e 修正成 2e; 主侧栏“安全撤销本次修改”恢复原文, 悬停说明属性为 0. 此项是安装后的普通聊天→真实模型→实际主侧栏确认按钮→原生编辑器写入/撤销闭环, 与此前分层测试分开记录.

测试临时选择 low/标准速度并暂停补全, 随后恢复原模型/档次/Fast/补全及当前会话. 仅删除此测试会话、此笔记和其改稿记录, 学习数据与测试前逐字一致, 原三段会话/设置再次比对一致, 临时文件不存在, 移动仿真仍关闭. 首次准备脚本尝试固定空学习来源被 schema 拒绝, 未发送模型请求; 恢复准备状态并仅在来源存在时固定后通过. 原生 dev:errors 返回过 PDF 页面的 RenderingCancelledException, 未归因, 不宣称应用运行时零错误.

## 未验收

iPad 真机改稿/软键盘/网络切换、全部阅读块/嵌入组合和本版中文 IME 手动输入尚未验收. 既有 Tab/IME 代码保留且 fixture 回归通过, 不冒充本轮真机输入. 模型语义边界只测原创有限样本, 不是完整数学审查. GitHub 发布与下载资产校验另记录实际结果, 不用本地安装成功代替发布验证.

## GitHub 交付回读

[0.9.0 公共预发布版本](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/0.9.0) 的不可变代码/tag 为 `7aa47b7c4b7fde6f9a2cac17fa1cf5812802a292`. [Actions 38762502227](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/38762502227) 安装依赖、构建、81 项 fixture 测试、打包、发布全通过. 匿名 API 回读 public=true、default_branch=codex/initial、draft=false、prerelease=true 和精确 tag.

六个公共资产全部实际下载并比对 GitHub SHA-256; 四个单独构建文件与本机生成/安装字节相同. 插件 ZIP 恰含 manifest/main/map/styles 四文件; Windows 桥 ZIP 仅含 bundle、两启动/停止脚本、公开 README 及 scripts 目录, 各文件与 source build 相同. ZIP 名单检查初次因 PowerShell -join 比较括号错误失败, 列出真实成员并修正检查后通过, 非打包缺陷. Downloads 和源码 dist 的插件包均换成公共下载的相同字节, SHA-256 `054e6007ae3e34c414e6af280547b23f984e8660cd84e0d6aa5c0a38f515c2f1`.

最终 native reload + 真实账号/model/skill bootstrap 返回 0.9.0、7 个模型、math-writing 0.2.0. 三段原会话/具体设置/当前会话/连接模式再次比对一致, 临时笔记数量 0、mobile=false、EmulateMobile=null. 正常远程桥没有重启或改配对/网络入口, 0.8.0 text 契约保持兼容. 发布包成功不是 iPad 本版改稿真机验收.
