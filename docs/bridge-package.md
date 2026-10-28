# 独立 Windows 远程桥候选

此包是 `2.0.0-beta.2` 的独立桥程序, 使用 Node.js 24 和电脑已有的 Codex 登录. 不包含配对配置、会话、认证文件或私有 math-writing; 启动前在 Windows 安装并启用该技能.

已有服务先按 [迁移与回退](docs/migration.md) 保存数据, 经授权后停止旧程序, 替换程序并用同一私有配置启动. 不清空 StateDir 或更换配对身份. 先桥、后同一配对客户端; 新协议启用后的旧整份状态写入会被拒绝.

```powershell
.\scripts\start-bridge.ps1 -Config "D:\Private\config.json"
```

上述是待替换的示例路径. 首次初始化、私有 HTTPS 和 iPad 连接见 [远程指南](docs/ipad-setup.md), 能力/数据格式见 [协议说明](docs/sync-protocol.md). 启动脚本核对已有进程且隐藏窗口; 本包本身不注册后台任务或更改全局 Codex 配置.

候选不代表已在 iPad 真机验收. 原操作结果未知时先查询核对, 不重复发送推理. 整体历史可以超过单次 4 MiB 请求, 由有界分片/分页传输; 永久删除标记和未决凭证不按普通修改缓存寿命清理.
