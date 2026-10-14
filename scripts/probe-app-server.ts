// Opt-in startup probe. No model turn, authentication files or transcript reads.
import { CodexConnection } from "../src/rpc";
import { math_writing_skill } from "../src/skills";

async function probe_startup(): Promise<void>
{
	const Cli = process.env.CODEX_PROBE_CLI;
	const Cwd = process.env.CODEX_PROBE_CWD;
	if(!Cli || !Cwd) { throw new Error("Set CODEX_PROBE_CLI and CODEX_PROBE_CWD"); }
	const Connection = new CodexConnection(Cli, Cwd, () => {}, ErrorValue => console.error(ErrorValue.message));
	let Stage = "initialize";
	const Started = Date.now();
	const Timer = setTimeout(() => { console.error(JSON.stringify({ stage: Stage, timeout: true })); Connection.close(); }, 25000);
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_bridge_startup_probe", version: "0.6.2" }, capabilities: { experimentalApi: true } });
		Connection.send({ method: "initialized", params: {} });
		console.log(JSON.stringify({ stage: Stage, elapsedMs: Date.now() - Started }));
		Stage = "model/list";
		const Models = await Connection.request(Stage, { limit: 100, includeHidden: false, cursor: null });
		console.log(JSON.stringify({ stage: Stage, count: Models.data.length, elapsedMs: Date.now() - Started }));
		Stage = "skills/list";
		const Skill = math_writing_skill(await Connection.request(Stage, { cwds: [Cwd], forceReload: true }), Cwd);
		console.log(JSON.stringify({ stage: Stage, skill: Skill.name, elapsedMs: Date.now() - Started }));
	}
	finally { clearTimeout(Timer); Connection.close(); }
}

probe_startup().catch(() => { process.exitCode = 1; });
