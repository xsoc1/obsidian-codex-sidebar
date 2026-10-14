# iPad 远程使用 (0.7.1)

0.7.0 新增数学学习工作台, 0.7.1 延续同一远程协议并进一步折叠控件. iPad 默认收起“会话与连接”“上下文与学习”“模型与选项”和“提问与发送”. 展开“会话与连接”切换会话、新建或重连; 展开“提问与发送”输入问题、发送或停止回答. 折叠不会清空草稿或选择, 有草稿时标签会注明. 回答引用卡仍按需可见, 点击“追问这段”自动展开输入框. 工作台位于“上下文与学习”内. 新布局和工作台仍待真机验收; 下文既有基础问答成功不转算为这些功能通过.

新一次连接超时可将“移动网络传输”从默认“浏览器 Fetch”改为“Obsidian 原生请求”, 再保存并连接. 不自动切换或重发, 不改密钥、身份或 Windows 权限. 原生请求超时只停止等待, 底层可能继续执行; 未知结果应先重连核对. 本次原 Wi-Fi 下两种方式均超时且 Safari 很慢; 换手机热点后, 用户已确认 0.7.0 原生请求能加载模型、收到完整短回答, 普通桥重启后重连仍保留模型与原回答. 原 Wi-Fi 的延迟原因尚未定位, 不把这个结果推广为所有网络都已恢复.

iPad 运行 Obsidian 侧栏, Windows 电脑运行独立隐藏 Codex CLI. 电脑必须开机、联网, iPad 与电脑连接同一 Tailscale 私有网络. 用户通过 GitHub/BRAT 更新 0.6.2 后, 已确认模型列表显示及实际短问题完整回复, iPad 前台基础问答通过. Windows 原生插件另有远程对话和补全验证; iPad 的触控选区、补全确认、中文键盘及后台恢复仍待实测.

## 安装插件和连接

1. 从本版本插件包取出 `manifest.json`, `main.js`, `styles.css` (可另加 `main.js.map`), 放入 iPad vault 的 `.obsidian/plugins/codex-sidebar/`. 可用 vault 同步或支持隐藏目录的文件管理工具传入. 保留已有 `data.json`, 不把 Windows 私有服务配置同步到 vault.
2. 在 iPad Obsidian 的社区插件中启用 Codex Sidebar. 尚未发布到 Obsidian 社区目录, 需要手动安装或用 BRAT 的指定版本功能安装本仓库的发布标签. 重启或重载插件, 确认加载的是 0.7.1. 从旧版升级仅替换插件构建文件, 保留 data.json 和 remote-*-state.json; 地址、密钥与聊天记录不需要清空. 从 0.7.0 更新本次布局时, 现有 Windows 桥可以继续运行.
3. 打开插件设置, 填写电脑的私有 HTTPS 地址与配对密钥, 点击 `保存并连接`. 两项来自电脑私有目录中的 `connection-private.json`: `Url` 是地址, `Token` 是密钥. 不填 Codex 登录密码或 OpenAI API key. iPad 与服务绑定的 vault 名称必须一致.
4. 用工具栏的机器人按钮或命令面板的 `Codex Sidebar: 打开/收起聊天栏` 打开侧栏. 首次连接从实际模型列表初始化一个具体选择; 之后保存并恢复模型、思考档次、Fast 与开关选择.
5. 先发一个短问题. 再选中笔记中的一段文字, 查看上下文卡片后解释/检查证明. 回答里的文字可选中并通过 `追问这段` 引用. 行内补全在侧栏确认插入, 保留 Obsidian 原生 Tab. 编辑已发送的问题并重发会保留原会话并创建分支.

地址和密钥保存在此设备的 Obsidian localStorage, 不写入共享桌面 `data.json`. 这不是操作系统钥匙串. 各设备应使用不同的配对密钥; 使用同一个密钥的客户端会连接同一远程 Agent. 清除应用存储后需重新填写连接信息.

远程记录由 Windows 桥保存; 此设备另用独立随机名称缓存文本. 桌面本地聊天不进入远程记录, 远程模式也不覆盖桌面聊天. 每个配对设备拥有单独的隐藏 app-server 进程、临时线程和记录文件, 共用电脑当前用户已有的 Codex 登录. 会话不会登记为 Codex GUI 聊天.

## Windows 服务

源码构建会生成 `bridge.cjs`. 单独的 Windows 桥包包含此文件和 `scripts/start-bridge.ps1`, `scripts/stop-bridge.ps1`. 电脑需有 Node.js 22+、已登录的 Codex CLI、已安装启用的 math-writing. 使用 Obsidian 只读查询工具时, Windows Obsidian 也需打开对应 vault 并启用 CLI.

首次初始化 (将示例路径替换为本机路径):

```powershell
node .\bridge.cjs --init --config "$env:LOCALAPPDATA\CodexObsidianRemote\config.json" --cwd "D:\Vault\数学" --cli "D:\Tools\codex.exe" --vault "数学" --obsidian-cli "D:\Obsidian\Obsidian.com"
.\scripts\start-bridge.ps1
```

初始化仅生成一个设备密钥, 配置已存在时拒绝覆盖. 默认配置在 `%LOCALAPPDATA%\CodexObsidianRemote`, 不应放入同步的笔记库或公开仓库. `config.json` 保存固定路径和密钥哈希; `connection-private.json` 保存需填写到 iPad 的密钥; `isolated-ipad-state` 保存远程问答与源快照. 保持此目录私有.

启动脚本隐藏窗口, 记录 `service.pid`, 重复启动会核对已有进程. 停止脚本只结束核对过的桥进程及其子进程, 会中断正在生成的远程回答:

```powershell
.\scripts\stop-bridge.ps1
.\scripts\start-bridge.ps1
```

脚本默认使用上述私有配置和其上一级的 `bridge.cjs`, 可通过 `-Config` 与 `-Bridge` 显式指定路径. 当前不会自动注册开机任务; 重启 Windows 后需要运行启动脚本. 启动失败查看私有目录中的 `service-error.log`.

## 私有 HTTPS 入口

桥只监听 `127.0.0.1:17895`, 原始 Codex RPC 不对网络开放. 推荐由 Tailscale Serve 转发, 不启用公网 Funnel:

```powershell
tailscale status
tailscale serve status
tailscale serve --bg --https=443 --set-path=/obsidian-codex http://127.0.0.1:17895
```

配置前检查 443 上的 `/obsidian-codex` 路径未被已有服务占用, 保留其他路由. 使用 `https://<电脑的私有DNS名>/obsidian-codex` 填写到 `connection-private.json` 的 `Url` 和插件设置, 不在基础地址末尾加 `/info`. 原来配置的 8445 地址也可用于具备对应网络可达性的设备. iPad 的 Tailscale 必须已连接并有访问该电脑的权限. 首次 Serve 如需在账户页面启用 HTTPS, 按 Tailscale 自己的提示操作.

所有接口都需要配对密钥. 插件拒绝非 HTTPS 网络地址; localhost HTTP 仅用于本机测试. 密钥通过 Authorization 请求头发送, 不放进 URL、日志或公开安装包. 撤销设备时从私有 `config.json` 移除对应 `Clients` 项并重启桥; 其他设备条目保留. 额外设备须生成独立随机令牌及 SHA-256 哈希并登记不同 ID, 当前未提供多设备配对向导.

连接报网络错误时, 先在同一台 iPad 的 Safari 打开 `<基础地址>/info`. 无密钥访问返回 `远程配对密钥无效` 是预期的连通性结果, 不要求在 Safari 输入密钥. Safari 也打不开时, 先定位该设备的私有网络/DNS/HTTPS 路径, 不据电脑端成功就宣布 iPad 已恢复. Safari 正常后再核对插件使用相同的基础地址、密钥和实际连接结果. 2026-10-13 的用户实测中, 8445 的诊断地址不可访问, 新增 443 子路径第一次也失败、随后返回预期 JSON; 该观察支持使用已实测可达的入口, 尚不证明端口是唯一根因.

Safari 能返回 JSON 但加载很慢, 也不足以通过插件连接验收. 服务端耗时从请求到达后才开始计时, 不包含客户端 DNS、TCP/TLS 建连及整个往返等待. 可在电脑网络不变的情况下, 让 iPad 临时换一个网络作对照, 前提是该网络上 Tailscale VPN 已成功连接. VPN 无法建立时, 该对照不能区分插件和原网络问题. iPad 的按需连接规则可能限制 Wi-Fi 网络, 其他 VPN 也可能阻止 Tailscale; 先核对实际设置, 不据此认定根因或删除配置. 参考 [VPN On Demand](https://tailscale.com/docs/features/client/ios-vpn-on-demand) 和 [其他 VPN 的兼容边界](https://tailscale.com/docs/reference/faq/other-vpns).

## 使用与恢复边界

- 笔记选区、阅读位置与未保存内容由客户端捕获后发送. Windows 只读工具读到的是电脑副本, 可能落后于 iPad; 内置提示词要求区分来源, 优先使用本次客户端快照.
- 远程问答保持固定 vault、只读权限和 `approvalPolicy=never`. 不支持远程批准写入、通用 shell、全局 Codex 设置、账号操作或浏览桌面聊天.
- math-writing 在 Windows 自动发现并在每次聊天/补全中显式加载. 缺失或禁用会阻止请求. 最小改动、原思路证明、重大重建先征求用户决定与模仿原稿语言等固定准则继续生效.
- 客户端断开后, 电脑继续生成并保存回答. 网络恢复后点击 `重连`, 恢复桥保存的文本及当前运行状态. 超出事件缓存窗口时也需要重连. 网络超时不会自动重发未知结果的问题.
- 移动端普通 HTTP 在前台等待超过 30 秒会取消并显示具体接口; 补全请求上限 120 秒. 准备阶段显示当前会话、技能、工作说明或提问保存步骤. 切后台/锁屏可能暂停客户端脚本, 不能承诺后台也精确在上述秒数显示提示. 移动浏览器传输需要桥的 CORS 预检支持; 升级插件时同时更新电脑 bridge.cjs 并重启独立桥. 预检不读取记录或启动 Agent, 正式请求仍用 Authorization 配对认证, 不发送 Cookie. 实施依据为 [Fetch 标准](https://fetch.spec.whatwg.org/#http-access-control-allow-origin).
- 当前 CLI 的临时线程不支持 `thread/read(includeTurns=true)`. 桥用自己收到的事件、文本记录和运行状态续接原线程; 桥重启后新建临时线程并注入保存的问答. 不恢复完整工具输出和进程状态.
- 补全仅返回建议, 由客户端检查文档/光标/输入法状态并在侧栏确认. 电脑不直接写入笔记. 不支持 PDF 页面识别、截图/OCR.

## 已验证与待验收

2026-10-13 已验证: TypeScript/esbuild、33 项测试; 无 Node/Electron 的移动入口初始化; 双设备身份的受控进程/记录/事件隔离及越权拒绝; Windows 原生插件经 HTTPS 的实际回答与 math-writing; 客户端未同步快照、真实远程补全; 临时线程重连续聊和桥重启后的文本恢复. Windows 本地聊天与设置的保留另在本版本记录中核对.

2026-10-14 真机后续: 用户先前在 0.6.2 确认基础问答成功. 新一次 0.7.0 排查中, 手机热点上的原生请求也得到用户确认: 模型加载及“只回复: 连接成功”的完整回答. 元数据对应实际模型/技能/轮次调用, 保存的末条回答为 completed. 已移除临时追踪并恢复普通隐藏桥, 重启前后远程记录 SHA-256 相同; 用户重连后确认模型与原回答仍在. 这次通过热点下前台基础问答和会话重连, 不能替代新版工作台/布局及其他交互检查. 仍需检查中文输入/软键盘、触控选区和公式、补全确认、引用追问/编辑重发、分屏、切后台/锁屏及持续网络切换. 建议先手动补全, 确认正常后启用自动补全. 遇到问题可记录版本、操作、侧栏错误文字和网络状态; 不分享配对密钥或私有聊天记录.
