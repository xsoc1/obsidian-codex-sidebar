import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

interface RuntimeFiles { exists(Path: string): boolean; folders(Path: string): string[]; modified(Path: string): number; }
const Files: RuntimeFiles = { exists: existsSync, folders: Path => readdirSync(Path, { withFileTypes: true }).filter(D => D.isDirectory()).map(D => D.name), modified: Path => statSync(Path).mtimeMs };

export function resolve_codex_executable(Cli: string, Host: RuntimeFiles = Files): string
{
	if(!/\/OpenAI\/Codex\/bin\/[0-9a-f]{16}\/codex\.exe$/i.test(Cli.replace(/\\/g, "/"))) { return Cli; }
	const Required = ["codex.exe", "codex-code-mode-host.exe", "codex-command-runner.exe", "codex-windows-sandbox-setup.exe"];
	const Complete = (Directory: string) => Required.every(Name => Host.exists(join(Directory, Name)));
	if(Complete(dirname(Cli))) { return Cli; }
	const Root = dirname(dirname(Cli));
	try
	{
		const Candidates = Host.folders(Root).filter(Name => /^[0-9a-f]{16}$/i.test(Name)).map(Name => join(Root, Name)).filter(Complete).sort((A, B) => Host.modified(B) - Host.modified(A));
		if(Candidates.length) { return join(Candidates[0], "codex.exe"); }
	}
	catch { }
	throw new Error("Codex 应用缓存中的运行包不完整, 缺少配套工具宿主. 请在插件设置中选择包含 codex-code-mode-host.exe 等配套文件的完整 Codex 运行包; 未更改登录或全局配置");
}
