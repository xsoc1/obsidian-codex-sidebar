import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
export { CodexConnection } from "./rpc";
export { CompletionService } from "./completion";
export { existsSync };

export function skill_version(Path: string): string
{
	const Header = readFileSync(Path, "utf8").slice(0, 4096).split("---")[1] ?? "";
	return Header.match(/^\s*version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?)/m)?.[1] ?? "未确认";
}

export function discover_cli(): Promise<string>
{
	return new Promise((Resolve, Reject) =>
	{
		execFile("where.exe", ["codex.exe"], { windowsHide: true, timeout: 5000 }, (ErrorValue, Output) =>
		{
			const Path = Output?.trim().split(/\r?\n/).find(Value => existsSync(Value));
			if(ErrorValue || !Path)
			{
				Reject(new Error("未找到 codex.exe. 请在插件设置中填写本机 Codex 可执行文件路径"));
			}
			else
			{
				Resolve(Path);
			}
		});
	});
}

export function obsidian_cli(Custom: string): string
{
	return Custom.trim() || (existsSync(join(dirname(process.execPath), "Obsidian.com")) ? join(dirname(process.execPath), "Obsidian.com") : "obsidian");
}
