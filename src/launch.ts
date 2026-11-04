import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

interface RuntimeFiles { exists(Path: string): boolean; folders(Path: string): string[]; modified(Path: string): number; }
const Files: RuntimeFiles = { exists: existsSync, folders: Path => readdirSync(Path, { withFileTypes: true }).filter(D => D.isDirectory()).map(D => D.name), modified: Path => statSync(Path).mtimeMs };
const RuntimePrograms = ["codex.exe", "codex-code-mode-host.exe", "codex-command-runner.exe", "codex-windows-sandbox-setup.exe"];
const complete_runtime = (Directory: string, Host: RuntimeFiles) => RuntimePrograms.every(Name => Host.exists(join(Directory, Name)));

function newest_complete_runtime(Root: string, Host: RuntimeFiles): string | undefined
{
	try
	{
		const Directories = Host.folders(Root).filter(Name => /^[0-9a-f]{16}$/i.test(Name)).map(Name => join(Root, Name))
			.filter(Directory => complete_runtime(Directory, Host)).sort((A, B) => Host.modified(B) - Host.modified(A));
		if(Directories.length) { return join(Directories[0], "codex.exe"); }
	}
	catch { /* The application may not have created its runtime cache yet. */ }
}

export function discover_app_codex(LocalAppData: string | undefined, Host: RuntimeFiles = Files): string | undefined
{
	return LocalAppData ? newest_complete_runtime(join(LocalAppData, "OpenAI", "Codex", "bin"), Host) : undefined;
}

export function resolve_codex_executable(Cli: string, Host: RuntimeFiles = Files): string
{
	if(!/\/OpenAI\/Codex\/bin\/[0-9a-f]{16}\/codex\.exe$/i.test(Cli.replace(/\\/g, "/"))) { return Cli; }
	if(complete_runtime(dirname(Cli), Host)) { return Cli; }
	const Replacement = newest_complete_runtime(dirname(dirname(Cli)), Host);
	if(Replacement) { return Replacement; }
	throw new Error("Codex 应用缓存中的运行包不完整, 缺少配套工具宿主. 请在插件设置中选择包含 codex-code-mode-host.exe 等配套文件的完整 Codex 运行包; 未更改登录或全局配置");
}
