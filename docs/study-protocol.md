# 交互协议与技能衔接

## 模块与来源

src/study 分为 task、schema、document、manifest、store/validate-store、controller、writer、obsidian-host、diff、presentation、panel、export. main.ts 只接线原会话与呈现, 没有新聊天后端或前端框架. 前端不静态引入 Node/Electron.

TaskSpec SchemaVersion=1 保存任务 ID、动作、输入角色、范围、提示程度、原 Source/直接前置、来源核验登记、时间与请求, 以及可选练习/尝试关联、写作计划和宿主目标. 目标完整 Before 仅在本设备任务/写回记录, 不发给模型或远程聊天状态. 模型收到原捕获片段及直接需要的 WriteUnit.

任务信息在 text 输入中序列化, 不是未知 turn/start 字段. 重发复制原任务/来源/目标基线并新建 ID; 反馈重发新建尝试, 不改旧记录. 重新捕获另走明确动作. 说明/检查不授予改写题面、教师原题或相邻答案的权限.

## Codex 协议

本机 generate-ts 核对 UserInput、TurnStartParams、ThreadItem/MessagePhase; [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server) 核对初始化、技能输入、注入和完成事件. 继续沿用已核对的 model/effort/serviceTier、ephemeral、read-only 和 never, 不增加高权限 RPC.

每次 turn/start 恰好 text + math-writing skill 两项. 结构化输出通过 text 的格式约定与运行时校验实现; 本版不新增 outputSchema 透传或其他技能. Task/Phase/CompletionStatus 是插件记录, 不作为未知 Codex 参数发送.

agentMessage.phase 区分 commentary 与 final_answer. 中途说明留在会话; 结构化结果只取最终回答. 无 phase 的已完成旧消息回退到最后回答; interrupted/failed 不接纳. 桥按原 Prompt 关联轮次 ID, 保存阶段和完成状态, 支持客户端未收到响应确认时恢复. 未知结果不自动重发.

## Schema 与写入

练习仅接受 schemaVersion/kind/statement/hints/solution/verification, 四种题型, 提示最多四层, 解答可 null, verification 只能 unverified. 反馈仅接受 schemaVersion/verdict/explanation, verdict 可 uncertain. 稿件仅接受 schemaVersion/markdown/rationale/verification; 单元提案另含 insert-after 或 replace-unit, 必须与用户指定范围一致.

拒绝额外字段、非法枚举、超长文本、损坏 JSON、常见双重转义. 模型文本不定义可执行 JS、shell 或文件操作. 格式成功从不升级为已证明或已获授权.

客户端流程为实际目标/未落盘内容 → SHA-256/唯一单元 → 生成/校验 → 差异/渲染预览 → 明确确认 → 重新核对 → API 写入 → 回读. 活动编辑器用最小替换的 Editor.transaction 保留撤销; 无活动编辑器用 [Vault.process 原子读改写](https://docs.obsidian.md/Plugins/Vault). 多编辑器不一致或无法保证单一编辑入口则拒绝.

本地 journal 先记 pending. 重复确认、迟到结果、清除期间异步输出有去重/拒绝路径. 仅当前文本等于 After 时允许安全撤销. iPad 写入由其客户端完成, 不调用 Windows 写工具.

## 技能与教学

维护时核对安装声明 v0.2.0, 读取 intro-lecture、pedagogy、branches、typesetting、tools、lecture-regression. 未复制私有技能/参考文件到 Git. 通过当前 cwd 的 skills/list 发现, 每轮显式附加 math-writing; 缺失/禁用阻止发送.

桌面显示发现技能的声明版本; 新桥通过 /info 的 bridge 元数据提供版本, 不改变 skills/list 契约. 旧桥或无声明显示未确认, 使用本轮核对的内置等效规则: 知识与运算熟练度分开、主线/方法用途、贯穿例子、依赖闭合、完整定义/首次运算/主要证明和可选主动回忆. 版本声明不认证全部技能内容.

不固定 70/30 挖空, 不把必要正文转交习题. 原始 JSON 的显式查看/复制也记为提示/答案揭示. 接受不同正确解法, 用户要完整答案时直接提供. 不创建后台复习或任意远程编译.
