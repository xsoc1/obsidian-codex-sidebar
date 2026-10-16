# 0.10.1 修改方案采用请求的路由修复

2026-10-16 用户反馈选择 AI 自选写入后仍被只读行为阻挡. 源/开发树开始均干净, 基线为 4ab2533. Windows 现场安装为 0.10.0, 本轮空闲、技能就绪; 最近“将你这个笔记改动方案落地”消息没有 edit Task, 本地修改日志为空. 当时消息附带过其他笔记的快照; 后来的当前位置已换为目标讲义, 不能据此改写旧快照或认定所有历史拒绝原因相同. 未公开课程正文或真实学习记录.

可重复的失败命令:

```sh
npx tsx --eval 'import {strict as assert} from "node:assert"; import {edit_intent} from "./src/edit/protocol"; assert.equal(edit_intent("将你这个笔记改动方案落地"),true);'
```

基线实际返回 false 并触发 AssertionError. 修改前的 `adopting` 单元及实际构建移动入口测试同样失败, 后者提交普通聊天而非结构化 edit Task. 原范围匹配/写入去重不是这条请求的失败位置. 原“本轮方式”隐藏在修改选项内, AI scope 只调整生成任务的范围, 不覆盖 auto/question 路由.

修复补充采用/应用/落地旧改稿的请求识别, 保留拒绝修改、讨论/建议及明确 question 模式. “本轮方式”从范围折叠中移到发送区直接显示, 问答提示明确进入预览的方法及当前来源; 不加悬停说明. 目标仍由原快照和客户端限定, 不允许模型自行换文件, 不扩展只读工具权限或移除确认. 旧普通消息重发不转成新任务, 采用旧稿需在正确来源下新发请求.

- 基线 build/89 项 fixture 通过. 修复后 build/91 项 fixture 通过. 实际构建插件的移动安全 VM 入口将同一句采用请求变成 EditMode=ai 的 task, 即使已有“工具只读”的旧助手回答. 请求仍只有 text+math-writing, 窗口/本地基线/预览零写入/确认/去重/撤销及原回归约束保持. VM 使用 mock 网络和模型结果, 不是设备真机或真实推理.
- `CODEX_EDIT_SCOPE=ai CODEX_EDIT_FOLLOWUP=1 CODEX_EDIT_TEST_CLI=<installed-cli> npx tsx scripts/edit-live.ts` 实际完成一次隔离 hidden/ephemeral/read-only/never 模型请求. 仅使用原创微型李代数笔记, 先注入“工具只读、尚未写入”及 e→2e 方案, 再提交同一句采用请求的真实 Task. gpt-6.1-sol/low/default 与 math-writing 0.2.0, 两输入, turn completed, 输出 schema/唯一范围通过, 全文仅修正 e→2e. 内存 host 的零预览写入、重复确认、安全撤销、陈旧拒绝通过. 此项是真模型和内存写入, 没有假称新版本已原生安装.
- `scripts/check-sidebar-layout.mjs` 检查 8 组移动尺寸/主题和 4 组桌面尺寸/主题. 明确预览方式在范围折叠之外可见, 采用语句进入预览, 中文草稿/焦点/选择/折叠保留, 无横向溢出/悬停属性. 首次布局检查发现新增控件挤小桌面回答区, 改为紧凑单行方式选择及短屏输入高度后, 320×620 有选区且发送展开时回答区约 126px, 原阈值未降低. Headless 不是 iPad 真机.
- 当前日常 0.10.0 的已有控件已临时切到 edit+ai, 展开发送及修改选项, 按钮实际为“生成修改预览”. 草稿、快照、消息数均未变, 未提交模型请求或写入笔记. 日常构建文件仍保持 0.10.0. 该控件选择不是新版本安装验收.

上述候选完成后, 用户明确批准“安装 Windows 并发布 GitHub”. 备份原四个构建文件、data.json 与设备本地记录后, 仅替换四文件并重载到 0.10.1; 原会话/设置/活动 ID/学习/修改记录/连接方式匹配, 七个模型与 math-writing 0.2.0 就绪.

实际 Windows 主侧栏选择 auto+ai, 在原创临时笔记中只选开头说明, 加入一条含只读措辞的旧方案, 从真实发送按钮提交原句. 模型 completed 后创建 AI edit Task 和精确 e→2e 提案, 确认前编辑器及文件均未改变. 第一轮原生确认用固定等待时间断言未通过, 清理前未保存当时写回状态, 不把原因断言为产品故障或特定时序问题. 同一真实输出在另一个原创临时笔记原生重放, 确认/撤销通过. 随后另开临时会话再次提交真正模型请求, 改用有界等待实际渲染/写回状态, 完整“原句→真实模型→预览零改动→主侧栏双击确认→精确编辑器结果→安全撤销”通过. 方式选择在范围折叠之外可见; 原生代表性深色截图已查看.

清理脚本曾先移除活动测试会话, 再恢复 ActiveId, 期间窗口回调出现 Messages TypeError. 这是脚本造成的暂时无效状态; 后续清理必须先切到保留的活动会话, 再移除测试会话/关闭笔记. 已恢复并重载, 核对原三个会话 ID/消息、具体模型/档次/Fast 等设置、活动会话、原快照、学习/修改数据和旧 v1 原字节相同, 三类临时笔记均清除, mobile=false/EmulateMobile=null. 恢复后的刷新/selectionchange 回调未增加错误记录. 旧 RenderingCancelledException 及测试清理错误留在原生日志, 不宣称零错误.

未启动/重启桥、未改配对/全局配置或认证文件, 真实课程正文未改动. iPad 真机及手动 IME 未验收. GitHub 发布与资产校验另记录实际结果. 回退只需保留/恢复原四个构建文件, 没有新的学习/修改数据迁移.

公开交付回读: 代码/不可变标签 `2851ab3b0dd747d631788b3fbe3b1eea4b1bd7bb`, 分支和标签原子推送. [Actions 38881971148](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/38881971148) 安装/构建/91 项 fixture/打包/发布步骤全部成功. 匿名回读确认仓库公开、默认分支 codex/initial、标签一致, [0.10.1 release](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/0.10.1) 为 draft=false/prerelease=true, 六件资产齐全. 每件下载内容 SHA-256 与 GitHub digest 相同; 四个独立插件文件与本地构建及 Windows 安装字节相同. 插件 ZIP 恰含四个匹配文件, 桥 ZIP 恰含匹配的公共桥/脚本/指南及 scripts 目录. 直连 Node 下载连接超时, 本次命令加 --use-env-proxy 复用已有环境后校验完成, 没有改全局网络配置或重发模型请求.

Downloads、源树、开发树中的自有候选 ZIP 经旧 hash 检查后替换为公开字节. 插件 ZIP SHA-256 为 `45f2f695d141d17b8976a158618aa6eb44174bc6058ffd8efe98a6cd25ed99d7`; 桥 ZIP 为 `0fe4ddcfa3ee22b7f390a581cb25e07cb8d69e7ad362af8052a9e7827332a407`. 现有远程桥/配对/网络未改动; 本版无协议或技能输入扩展. 此记录不改变标签或发布资产.
