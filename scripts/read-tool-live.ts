// Opt-in real tool round-trip; only version and an aggregate note count leave the host.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { ObsidianTool, run_obsidian_read } from "../src/obsidian-tool";
import { math_writing_skill, skill_input } from "../src/skills";

async function run_live(): Promise<void>
{
	const Cli = process.env.CODEX_READ_TEST_CLI, Obsidian = process.env.CODEX_READ_TEST_OBSIDIAN, Vault = process.env.CODEX_READ_TEST_VAULT;
	if(!Cli || !Obsidian || !Vault) { throw new Error("Set CODEX_READ_TEST_CLI, CODEX_READ_TEST_OBSIDIAN and CODEX_READ_TEST_VAULT; no auth/config files are read"); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-read-live-"));
	writeFileSync(join(Directory, "AGENTS.md"), "# Original tool acceptance\nOnly call obsidian_cli_read for version or files with ext=md,total=true. Do not read notes, auth, configs or other files. No writes or other tools.\n");
	const Calls: { command: string; success: boolean; bytes: number }[] = [], Done = new Map<string, any>(), Trace: any[] = [];
	let Connection: CodexConnection, Wake: (() => void) | undefined;
	const Notify = (Value: RpcMessage) =>
	{
		if(Value.id !== undefined && Value.method)
		{
			const P = Value.params, Input = P?.arguments;
			Trace.push({ method: Value.method, tool: P?.tool, argumentType: typeof Input, command: Input?.command, keys: P ? Object.keys(P) : [] });
			if(Value.method !== "item/tool/call" || P?.tool !== "obsidian_cli_read" || !["version", "files"].includes(Input?.command) || (Input.command === "files" && (Input.params?.ext !== "md" || Input.params?.total !== true)))
			{ Connection.send({ id: Value.id, error: { code: -32601, message: "Only the two metadata checks are authorized in this acceptance" } }); return; }
			void run_obsidian_read(Obsidian, Vault, Input).then(Result => { Calls.push({ command: Input.command, success: Result.success, bytes: Result.contentItems[0].text.length }); Connection.send({ id: Value.id, result: Result }); });
			return;
		}
		if(Value.method === "item/completed" && Value.params.item.type === "agentMessage") { Trace.push({ answer: Value.params.item.text }); }
		if(Value.method === "turn/completed") { Done.set(Value.params.turn.id, Value.params.turn); Wake?.(); }
	};
	Connection = new CodexConnection(Cli, Directory, Notify, () => {});
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_read_acceptance", version: "1.1.0" }, capabilities: { experimentalApi: true } }); Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		const Catalog = await Connection.request("model/list", { limit: 100, includeHidden: false }), Model = Catalog.data.find((M: any) => M.model === "gpt-6.1-sol") ?? Catalog.data.find((M: any) => M.isDefault);
		assert.ok(Model); const Effort = Model.supportedReasoningEfforts.find((E: any) => E.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Thread = await Connection.request("thread/start", { cwd: Directory, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", dynamicTools: [ObsidianTool], model: Model.model, developerInstructions: "This is a two-call original metadata-only acceptance. Use obsidian_cli_read for version, then files with params ext=md,total=true. Do not read note content or use any other tool. Return a brief acknowledgement after both tool responses." });
		assert.equal(Thread.thread.path, null);
		const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, model: Model.model, effort: Effort, serviceTier: "default", input: skill_input("执行两项已授权的元数据读取测试: version; files(params ext=md,total=true). 必须实际调用工具, 不读取笔记正文或其他文件. 完成后简短确认.", Skill) });
		for(let I = 0; I < 120 && !Done.has(Turn.turn.id); I++) { await new Promise<void>(R => { const T = setTimeout(R, 1000); Wake = () => { clearTimeout(T); R(); }; }); }
		assert.equal(Done.get(Turn.turn.id)?.status, "completed"); assert.ok(["version", "files"].every(C => Calls.some(V => V.command === C && V.success)));
		const Report = { tier: "real Codex + hosted read tool + native Obsidian CLI; metadata only, not iPad", model: Model.model, effort: Effort, calls: Calls, noNoteContentUploaded: true, noNoteWrites: true };
		writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
	}
	finally { writeFileSync(join(Directory, "trace-private.json"), JSON.stringify({ Calls, Trace }, null, 2)); console.log(JSON.stringify({ directory: Directory, calls: Calls, requestShapes: Trace.filter(T => T.method) })); Connection.close(); }
}
run_live().catch(E => { console.error(String(E)); process.exitCode = 1; });
