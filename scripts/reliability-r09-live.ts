// Explicit, three-turn acceptance on original fixtures and an owned ephemeral process.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { HistoryReadTool, read_history_page } from "../src/history-budget";
import { DefaultInstructions } from "../src/prompt";

async function main()
{
	if(process.env.CODEX_R09_LIVE !== "1") { throw Error("Requires explicit CODEX_R09_LIVE=1"); }
	const Cli = process.env.CODEX_R09_CLI, Root = process.env.CODEX_R09_EVIDENCE;
	if(!Cli || !Root || !existsSync(Cli)) { throw Error("Provide the installed CLI and a fresh private evidence directory"); }
	const Directory = resolve(Root), LedgerPath = join(Directory, "ledger.json");
	if(existsSync(LedgerPath)) { throw Error("Existing ledger refuses repeat inference; inspect the saved turn IDs"); }
	mkdirSync(Directory, { recursive: true });
	writeFileSync(join(Directory, "AGENTS.md"), "# Original acceptance fixtures\nUse only the original supplied mathematics and enabled math-writing. No private notes, credentials, configuration, shell, writes or additional tools.\n");
	const Ledger: any = { schemaVersion: 1, platform: "Windows local Codex app-server", submitted: 0, cases: [] };
	const Save = () => writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2)); Save();
	const Done = new Map<string, any>(), Outputs = new Map<string, string>(), Waiters = new Map<string, (T: any) => void>();
	const Reads: unknown[] = [], Original = [{ Id: "original-lemma-a", Role: "assistant" as const, Text: "原创标识 CEDAR-NORM-37。由三角不等式，||x||≤||x-y||+||y||，交换 x,y 后得 ||y||≤||x-y||+||x||，合并得到 | ||x||-||y|| |≤||x-y||。不要求完备。" }];
	let Connection: CodexConnection, Closing = false;
	Connection = new CodexConnection(Cli, Directory, (M: RpcMessage) =>
	{
		const P = M.params;
		if(M.id !== undefined && M.method)
		{
			if(M.method === "item/tool/call" && P.tool === HistoryReadTool.name)
			{
				void read_history_page("original-r09", Original, P.arguments, "original-r09-scope").then(R =>
				{
					Reads.push({ thread: P.threadId, turn: P.turnId, args: P.arguments, success: R.success });
					Connection.send({ id: M.id, result: R });
				});
			}
			else { Connection.send({ id: M.id, error: { code: -32601, message: "Only the bound original history tool is available" } }); }
			return;
		}
		if(M.method === "item/agentMessage/delta") { Outputs.set(P.turnId, (Outputs.get(P.turnId) ?? "") + P.delta); }
		if(M.method === "item/completed" && P.item?.type === "agentMessage" && P.item.phase !== "commentary") { Outputs.set(P.turnId, P.item.text); }
		if(M.method === "turn/completed") { Done.set(P.turn.id, P.turn); Waiters.get(P.turn.id)?.(P.turn); }
	}, E => { if(!Closing) { writeFileSync(join(Directory, "process-error.txt"), E.message); } });
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "original_r09_acceptance", version: "1" }, capabilities: { experimentalApi: true } });
		Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		Ledger.skillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1].trim() ?? "unconfirmed";
		const Catalog = await Connection.request("model/list", { limit: 100, includeHidden: false });
		const Model = Catalog.data.find((M: any) => M.model === "gpt-6.1-sol");
		assert.ok(Model?.inputModalities?.includes("image")); Ledger.model = Model.model; Ledger.protocol = "official stdio app-server";
		for(const Name of ["history-text", "image", "stop"])
		{
			const Thread = await Connection.request("thread/start", { cwd: Directory, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model, developerInstructions: DefaultInstructions, dynamicTools: Name === "history-text" ? [HistoryReadTool] : [] });
			assert.equal(Thread.thread.ephemeral, true); assert.equal(Thread.thread.path, null);
			const Prompt = Name === "history-text" ? "先调用 obsidian_history_read，command=read，message_id=original-lemma-a，field=text，offset=0，length=2000。读取成功后说出原文的原创标识，并用不超过180字解释如何合并两个不等式。不要猜标识。"
				: Name === "image" ? "只根据附图，简短写出可见的主要公式和积分界。看不清时直接说明，不猜测。"
				: "请逐项详细展开200组二阶矩阵交换子的计算，每组给出完整矩阵乘法过程。";
			const Input: any[] = skill_input(Prompt, Skill);
			if(Name === "image") { Input.push({ type: "image", url: "data:image/jpeg;base64," + readFileSync("examples/pdf/scanned-page.jpg").toString("base64") }); }
			const Case: any = { name: Name, threadId: Thread.thread.id, status: "submission-unknown", skillLoaded: true, inputKinds: Input.map(I => I.type) };
			Ledger.cases.push(Case); Ledger.submitted++; Save();
			const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: "low", serviceTier: "default" });
			Case.turnId = Turn.turn.id; Save();
			if(Name === "stop") { await new Promise(R => setTimeout(R, 350)); Case.stopReceipt = await Connection.request("turn/interrupt", { threadId: Thread.thread.id, turnId: Turn.turn.id }); }
			let Timer: ReturnType<typeof setTimeout> | undefined;
			const Terminal = Done.get(Turn.turn.id) ?? await new Promise<any>((R, J) => { Waiters.set(Turn.turn.id, R); Timer = setTimeout(() => J(Error("Result unknown after timeout; do not resubmit")), 150_000); }).finally(() => { clearTimeout(Timer); Waiters.delete(Turn.turn.id); });
			Case.status = Terminal.status; Case.output = Outputs.get(Turn.turn.id) ?? ""; Case.successfulHistoryReads = Reads.filter((R: any) => R.turn === Turn.turn.id && R.success).length; Save();
			if(Name === "history-text") { assert.ok(Case.successfulHistoryReads >= 1); assert.match(Case.output, /CEDAR-NORM-37/); }
			if(Name !== "stop") { assert.equal(Case.status, "completed"); assert.ok(Case.output.trim()); }
			else { assert.equal(Case.status, "interrupted"); }
			process.stdout.write(JSON.stringify({ name: Name, status: Case.status, model: Model.model, successfulHistoryReads: Case.successfulHistoryReads, chars: Case.output.length }) + "\n");
		}
		writeFileSync(join(Directory, "history-reads.json"), JSON.stringify(Reads, null, 2));
	}
	finally { Closing = true; Save(); Connection.close(); }
}
void main().catch(E => { process.stderr.write(String(E) + "\n"); process.exitCode = 1; });
