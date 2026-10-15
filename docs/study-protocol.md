# 交互协议与技能衔接

## 模块与来源

src/study 分为 task、schema、document、manifest、store/validate-store、controller、writer、obsidian-host、diff、presentation、panel、export. main.ts 只接线原会话与呈现, 没有新聊天后端或前端框架. 前端不静态引入 Node/Electron.

TaskSpec SchemaVersion=1 保存任务 ID、动作、输入角色、范围、提示程度、原 Source/直接前置、来源核验登记、时间与请求, 以及可选练习/尝试关联、写作计划和宿主目标. 目标完整 Before 仅在本设备任务/写回记录, 不发给模型或远程聊天状态. 模型收到原捕获片段及直接需要的 WriteUnit.

0.9.0 普通聊天修改复用同一协议与确认写回器, 新增 Action=edit / Scope=note-edit、note 输入角色和宿主 replace-range 目标. 独立 src/edit 模块管理运行时 schema、原范围绑定、本地修改记录、输入选项与提案呈现; 不进入学习记录或远程整份状态覆盖. 见 [普通改稿协议](note-edits.md).

任务信息在 text 输入中序列化, 不是未知 turn/start 字段. 重发复制原任务/来源/目标基线并新建 ID; 反馈重发新建尝试, 不改旧记录. 重新捕获另走明确动作. 说明/检查不授予改写题面、教师原题或相邻答案的权限.

## Codex 协议

本机 generate-ts 核对 UserInput、TurnStartParams、ThreadItem/MessagePhase; [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server) 核对初始化、技能输入、注入和完成事件. 继续沿用已核对的 model/effort/serviceTier、ephemeral、read-only 和 never, 不增加高权限 RPC.

普通 turn/start 保留 text + math-writing skill 两项. 0.8.0 PDF 扩展最多追加两个官方 image 输入, 不添加第三个技能、任意客户端路径或 outputSchema 透传. Task/Phase/CompletionStatus 仍是插件记录, 不作为未知 Codex 参数发送. PDF 元数据/任务进入 text, 原图单独缓存. 本机用受校验的 data:image/jpeg URL; 远程只接受本配对设备已上传的 obsidian-pdf:<sha256> 引用, 由桥换成实际 data URL. /info 的 pdfPageImages:1 是明确能力检查, 旧桥提交前报错. bridge/pdf-images 仅支持 has(ids)/put(id,data,epoch)/clear, 固定私有设备目录、尺寸/大小/哈希/schema 校验, 不提供任意文件操作. 清除旋转 epoch 并拒绝迟到上传.

来源快照新增可选 Pdf (schemaVersion:1、ReadOnly:true、PageCount、Pages), 每页记录 Number、TextLayer、Image (Id/Width/Height/Bytes). 不保存可执行字段或内联 base64. 重发与新临时线程恢复沿原引用, 历史用已核对的 input_image/image_url, 不重捕获. PDF 练习记录继续设备本地存储, 版本比较使用实际 PDF 二进制哈希; Markdown 写入目标继续由独立 note_path 验证, PDF 不能成为目标. 详见 [PDF 协议/迁移边界](pdf-support.md).

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
