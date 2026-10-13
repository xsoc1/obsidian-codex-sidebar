const Commands: Record<string, string[]> =
{
	help: [], version: [],
	read: ["file", "path"],
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
	description: "Read-only bridge to the running Obsidian CLI in the current vault. Use for help, version, reading, searching, links and Bases. No shell, eval, writes or other vaults. params is an object of CLI name=value parameters or boolean flags. help accepts help_command separately.",
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
		execFile(Cli, Args, { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 512 * 1024 }, (ErrorValue, Stdout, Stderr) =>
		{
			const Output = [Stdout, Stderr, ErrorValue?.message].filter(Boolean).join("\n");
			Resolve({ success: !ErrorValue, contentItems: [{ type: "inputText", text: Output.slice(0, 64000) + (Output.length > 64000 ? "\n[CLI 输出已截断]" : "") }] });
		});
	});
}
