// One opt-in original request. Recovery never submits another turn.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { build_prompt, DefaultInstructions, snapshot_instructions, instruction_items, type ContextSnapshot } from "../src/prompt";
import { interactive_output } from "../src/interactive/protocol";
import { source_reference } from "../src/sources";
import { locate_symbol } from "../src/interactive/symbols";

async function main()
{
	if(process.env.CODEX_INTERACTIVE_LIVE !== "1" || !process.env.CODEX_INTERACTIVE_CLI) { throw Error("Set CODEX_INTERACTIVE_LIVE=1 and CODEX_INTERACTIVE_CLI"); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-interactive-live-"));
	const Text = "# 原创热方程样例\n\n设 $0\\le x\\le\\pi$, $t\\ge0$. 取 $u(x,t)=e^{-t}\\sin x$.\n\n这里 $t$ 为时间, $x$ 为空间位置. 直接求导得 $u_t=-e^{-t}\\sin x$ 与 $u_{xx}=-e^{-t}\\sin x$, 因此 $u_t=u_{xx}$. 又有 $u(0,t)=u(\\pi,t)=0$, $u(x,0)=\\sin x$. 这些计算只说明该函数是这个初边值问题的一个解, 尚未证明一般唯一性.\n";
	writeFileSync(join(Directory, "原创热方程.md"), Text); writeFileSync(join(Directory, "AGENTS.md"), "# Original isolated acceptance\nRead only supplied original material and enabled math-writing. No private notes, auth/config, shell or file changes.\n");
	const Context: ContextSnapshot = { Path: "原创热方程.md", Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text, SelectedText: "", LineStart: 0, LineEnd: Text.split("\n").length - 1, Heading: "原创热方程样例", CapturedAt: new Date().toISOString(), Truncated: false };
	let Output = "", TurnDone: any, Resolve: ((V: any) => void) | undefined;
	const Connection = new CodexConnection(process.env.CODEX_INTERACTIVE_CLI, Directory, (M: RpcMessage) =>
	{
		if(M.id !== undefined && M.method) { Connection.send({ id: M.id, error: { code: -32601, message: "No tools/approvals in this isolated test" } }); return; }
		if(M.method === "item/completed" && M.params.item.type === "agentMessage" && M.params.item.phase !== "commentary") { Output = M.params.item.text; }
		if(M.method === "turn/completed") { TurnDone = M.params.turn; Resolve?.(TurnDone); }
	}, E => process.stderr.write(String(E) + "\n"));
	console.log(JSON.stringify({ directory: Directory, inferenceSubmissions: 0 }));
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_interactive_acceptance", version: "2.0.0-beta.17" }, capabilities: { experimentalApi: true } }); Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		const Models = (await Connection.request("model/list", { limit: 100, includeHidden: false })).data;
		const Model = Models.find((M: any) => M.isDefault) ?? Models[0]; assert.ok(Model);
		const Effort = Model.supportedReasoningEfforts.find((E: any) => E.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Thread = await Connection.request("thread/start", { cwd: Directory, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model });
		assert.equal(Thread.thread.ephemeral, true); assert.equal(Thread.thread.path, null);
		await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(snapshot_instructions(DefaultInstructions, "只使用当前原创快照; 没有读库工具.")) });
		const Prompt = build_prompt("请完整解释这个具体解及条件, 附一幅可调时间 t 的参数图, 并给出 t 和边界条件的符号/条件卡, quote 逐字引用源快照. 不写笔记.", Context);
		const Input = skill_input(Prompt, Skill); assert.equal(Input.length, 2);
		writeFileSync(join(Directory, "request.json"), JSON.stringify({ prompt: Prompt, context: Context, model: Model.model, effort: Effort, status: "submitting", inferenceSubmissions: 1 }));
		const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: Effort, serviceTier: "default" });
		writeFileSync(join(Directory, "receipt.json"), JSON.stringify({ threadId: Thread.thread.id, turnId: Turn.turn.id, inferenceSubmissions: 1 }));
		let Timer: ReturnType<typeof setTimeout>;
		const Done = TurnDone ?? await new Promise<any>((R, Reject) => { Resolve = R; Timer = setTimeout(() => Reject(Error("Timed out, result unknown; do not automatically resubmit")), 180000); }).finally(() => clearTimeout(Timer));
		writeFileSync(join(Directory, "answer.md"), Output);
		const Parsed = interactive_output(Output, Done.status === "completed"), Locations = Parsed.Spec?.symbols.map(S => ({ id: S.id, ...locate_symbol(S, [Context], source_reference(Context)) }));
		const Report = { tier: "real isolated Codex app-server with explicit math-writing; not iPad/device", status: Done.status, model: Model.model, effort: Effort, inferenceSubmissions: 1, inputItems: Input.length, uiStatus: Parsed.Status, error: Parsed.Error, plots: Parsed.Spec?.plots.length, symbols: Parsed.Spec?.symbols.length, locations: Locations };
		writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
		assert.equal(Done.status, "completed"); assert.equal(Parsed.Status, "ready"); assert.ok(Parsed.Spec?.plots.length); assert.ok(Locations?.some(L => L.Status === "matched"));
	}
	finally { Connection.close(); }
}
void main().catch(E => { console.error(E); process.exitCode = 1; });
