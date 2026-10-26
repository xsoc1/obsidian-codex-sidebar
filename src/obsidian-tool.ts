const Commands: Record<string, string[]> =
{
	help: [], version: [],
	read: ["file", "path", "offset", "length", "version"],
	search: ["query", "path", "limit", "case", "format", "total"],
	"search:context": ["query", "path", "limit", "case", "format"],
	outline: ["file", "path", "format", "total"],
	file: ["file", "path"], files: ["folder", "ext", "total"], folders: ["folder", "total"],
	links: ["file", "path", "total"], backlinks: ["file", "path", "counts", "total", "format"],
	unresolved: ["total", "counts", "verbose", "format"],
	properties: ["file", "path", "name", "total", "sort", "counts", "format", "active"],
	"property:read": ["name", "file", "path"], tasks: ["file", "path", "total", "done", "todo", "status", "verbose", "format", "active"],
	tags: ["file", "path", "total", "sort", "counts", "format", "active"],
	bases: [], "base:views": ["file", "path"], "base:query": ["file", "path", "view", "format"],
	vault: ["info"]
};

export const ObsidianTool =
{
	type: "function",
	name: "obsidian_cli_read",
	description: "Read-only access to any indexed note in the current Obsidian vault. Decide what related notes are needed, then search, inspect links/outlines and read bounded pages; do not upload the whole vault. No shell, eval, writes, hidden configuration or other vaults. params is an object. read accepts path (or file), offset (zero-based UTF-16 character offset, default 0), length (1..64000, default 24000), version (optional prior page hash). It returns JSON with source, text, total_chars, next_offset, truncated and version. Continue with next_offset AND version; changed content is rejected. Paging fields belong to this bridge, not the Obsidian CLI. help accepts help_command separately.",
	inputSchema: { type: "object", properties: { command: { type: "string", enum: Object.keys(Commands) }, params: { type: "object", additionalProperties: true }, help_command: { type: "string" } }, required: ["command"], additionalProperties: false }
};

export function cli_arguments(Vault: string, Input: unknown): string[]
{
	if(!Input || typeof Input !== "object" || Array.isArray(Input))
	{
		throw new Error("CLI 参数必须是对象");
	}
	const Value = Input as Record<string, unknown>;
	const Command = Value.command;
	if(typeof Command !== "string" || !Object.hasOwn(Commands, Command))
	{
		throw new Error("只读 CLI 桥不支持该命令");
	}
	if(Object.keys(Value).some(Key => !["command", "params", "help_command"].includes(Key)))
	{
		throw new Error("包含未知工具参数");
	}
	const Args = [`vault=${Vault}`, Command];
	if(Value.help_command !== undefined)
	{
		if(Command !== "help" || typeof Value.help_command !== "string" || !/^[a-z][a-z:-]*$/.test(Value.help_command))
		{
			throw new Error("help 子命令格式无效");
		}
		Args.push(Value.help_command);
	}
	const Params = Value.params ?? {};
	if(typeof Params !== "object" || Array.isArray(Params))
	{
		throw new Error("params 必须是参数对象");
	}
	for(const [Key, Param] of Object.entries(Params))
	{
		if(!Commands[Command].includes(Key) || !["string", "number", "boolean"].includes(typeof Param))
		{
			throw new Error(`不允许的 CLI 参数: ${Key}`);
		}
		if(Command === "read" && ["offset", "length"].includes(Key))
		{
			if(typeof Param !== "number" || !Number.isSafeInteger(Param) || Param < (Key === "offset" ? 0 : 1) || (Key === "length" && Param > 64000)) { throw new Error("读取分页参数无效"); }
			continue;
		}
		if(Command === "read" && Key === "version") { if(typeof Param !== "string" || !/^[0-9a-f]{64}$/.test(Param)) { throw new Error("读取版本摘要无效"); } continue; }
		if(typeof Param === "boolean")
		{
			if(Param)
			{
				Args.push(Key);
			}
			continue;
		}
		const Text = String(Param);
		if(Text.length > 8000 || /[\u0000\r\n]/.test(Text))
		{
			throw new Error("CLI 参数过长或含非法字符");
		}
		if(["path", "file", "folder"].includes(Key) && (/^(?:[a-z]:|[\\/])/i.test(Text) || Text.split(/[\\/]/).includes("..")))
		{
			throw new Error("文件定位必须位于当前 vault 内");
		}
		if(["path", "file", "folder"].includes(Key) && Text.split(/[\\/]/).some(Part => Part.startsWith(".") && Part !== ".")) { throw new Error("只读取当前 vault 的索引内容, 不读取隐藏配置或认证目录"); }
		Args.push(`${Key}=${Text}`);
	}
	return Args;
}

export function run_obsidian_read(Cli: string, Vault: string, Input: unknown): Promise<{ success: boolean; contentItems: { type: "inputText"; text: string }[] }>
{
	const { execFile } = require("node:child_process") as typeof import("node:child_process");
	const Args = cli_arguments(Vault, Input);
	return new Promise(Resolve =>
	{
		execFile(Cli, Args, { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (ErrorValue, Stdout, Stderr) =>
		{
			const Output = [Stdout, Stderr, ErrorValue?.message].filter(Boolean).join("\n");
			const IsRead = (Input as any).command === "read";
			const Failed = !!ErrorValue || (IsRead ? /^Error: (?:File .+ not found\.|No active file\.?|Vault .+ not found\.?)$/.test(Output.trim()) : /^Error: [^\r\n]+$/.test(Output.trim()));
			if(!Failed && (Input as any).command === "read")
			{
				const Params = (Input as any).params ?? {}, Offset = Params.offset ?? 0, Length = Params.length ?? 24000;
				const Version = (require("node:crypto") as typeof import("node:crypto")).createHash("sha256").update(Stdout).digest("hex");
				if(Params.version !== undefined && Params.version !== Version) { Resolve({ success: false, contentItems: [{ type: "inputText", text: "文件在分页读取期间已变化, 拒绝拼接不同版本; 请从 offset=0 重新读取" }] }); return; }
				let End = Math.min(Offset + Length, Stdout.length);
				if(End < Stdout.length && /[\uD800-\uDBFF]/.test(Stdout[End - 1] ?? "") && Length > 1) { End--; }
				if(Offset > Stdout.length) { Resolve({ success: false, contentItems: [{ type: "inputText", text: "读取偏移超出当前文件; 文件可能已变化, 请从 offset=0 重新读取" }] }); return; }
				const Page = { source: Params.path ?? Params.file ?? "当前活动笔记", version: Version, offset: Offset, total_chars: Stdout.length, next_offset: End < Stdout.length ? End : null, truncated: End < Stdout.length, text: Stdout.slice(Offset, End) };
				Resolve({ success: true, contentItems: [{ type: "inputText", text: JSON.stringify(Page) }] }); return;
			}
			Resolve({ success: !Failed, contentItems: [{ type: "inputText", text: Output.slice(0, 64000) + (Output.length > 64000 ? "\n[CLI 输出已截断; 请缩小搜索范围或 limit]" : "") }] });
		});
	});
}
