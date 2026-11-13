// Opt-in semantic evaluation. Expected choices stay outside the model input.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { DefaultInstructions, build_prompt, snapshot_instructions, instruction_items, type ContextSnapshot } from "../src/prompt";
import { interactive_output } from "../src/interactive/protocol";
import { sample_plot } from "../src/interactive/plot";
import { source_reference } from "../src/sources";
import { locate_symbol } from "../src/interactive/symbols";
import { answer_quote } from "../src/quote";
import { history_items } from "../src/history";
import { InteractivePolicyCases } from "../tests/fixtures/interactive-policy";
import { ProductVersion } from "../src/version";

async function main(): Promise<void>
{
	if(process.env.CODEX_POLICY_LIVE !== "1" || !process.env.CODEX_POLICY_CLI) { throw Error("Set CODEX_POLICY_LIVE=1 and CODEX_POLICY_CLI; default six original requests, optional CODEX_POLICY_CASES selects cases"); }
	const Names = process.env.CODEX_POLICY_CASES?.split(",").filter(Boolean), Cases = Names ? Names.map(Id => { const C = InteractivePolicyCases.find(C => C.Id === Id); if(!C) { throw Error("Unknown policy case: " + Id); } return C; }) : InteractivePolicyCases;
	if(!Cases.length || new Set(Cases.map(C => C.Id)).size !== Cases.length || Cases.some((C, I) => C.Parent && !Cases.slice(0, I).some(P => P.Id === C.Parent))) { throw Error("Select unique cases; a follow-up requires its original parent first"); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-interactive-policy-")), Workspace = join(Directory, "workspace"); mkdirSync(Workspace);
	writeFileSync(join(Workspace, "AGENTS.md"), "# Original isolated test\nUse supplied original snapshots and enabled math-writing only. Read-only. No private notes/auth/config or filesystem changes. Do not inspect test logs or other directories.\n");
	const Texts = new Map<string, Map<string, string>>(), Done = new Map<string, any>(), Waiting = new Map<string, (Value: any) => void>();
	const Results: any[] = [], Answers = new Map<string, { Text: string; Prompt: string; Context: ContextSnapshot | null }>();
	const Connection = new CodexConnection(process.env.CODEX_POLICY_CLI, Workspace, (M: RpcMessage) =>
	{
		if(M.id !== undefined && M.method) { Connection.send({ id: M.id, error: { code: -32601, message: "No extra tools/approvals" } }); return; }
		const P = M.params;
		if(M.method === "item/completed" && P.item.type === "agentMessage" && P.item.phase !== "commentary")
		{
			const Parts = Texts.get(P.turnId) ?? new Map(); Parts.set(P.item.id, P.item.text); Texts.set(P.turnId, Parts);
		}
		if(M.method === "turn/completed") { Done.set(P.turn.id, P.turn); Waiting.get(P.turn.id)?.(P.turn); }
	}, E => process.stderr.write(String(E) + "\n"));
	console.log(JSON.stringify({ directory: Directory }));
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_interactive_policy", version: ProductVersion }, capabilities: { experimentalApi: true } }); Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Workspace], forceReload: true }), Workspace);
		const SkillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1] ?? "unconfirmed";
		const Models = (await Connection.request("model/list", { limit: 100, includeHidden: false })).data, Model = Models.find((M: any) => M.isDefault) ?? Models[0]; assert.ok(Model);
		const Effort = Model.supportedReasoningEfforts.find((E: any) => E.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Instructions = snapshot_instructions(DefaultInstructions, "只使用显式提供的原创快照及历史; 没有读库工具. 按当前工作指令回答用户问题.");
		for(const Case of Cases)
		{
			const Context: ContextSnapshot | null = Case.Source ? { Path: Case.Id + ".md", Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text: Case.Source, SelectedText: "", LineStart: 0, LineEnd: Case.Source.split("\n").length - 1, Heading: "原创样例", CapturedAt: "original-capture", Truncated: false } : null;
			if(Context) { writeFileSync(join(Workspace, Context.Path), Context.Text); }
			const Parent = Case.Parent ? Answers.get(Case.Parent) : undefined;
			if(Case.Parent && !Parent) { throw Error("Original parent answer unavailable, no replacement fabricated"); }
			const Quote = Parent ? answer_quote("original-session", Case.Parent!, "sin(k*x)", Parent.Text, "completed", { SourcePath: Parent.Context?.Path, SourceReferences: Parent.Context ? source_reference(Parent.Context) : [] }) : null;
			const Prompt = build_prompt(Case.Question, Context, Quote), Input = skill_input(Prompt, Skill); assert.equal(Input.length, 2);
			const Thread = await Connection.request("thread/start", { cwd: Workspace, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model }); assert.equal(Thread.thread.path, null); assert.equal(Thread.thread.ephemeral, true);
			await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(Instructions) });
			if(Parent) { await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: history_items([{ Id: "original-user", Role: "user", Text: "original question", Prompt: Parent.Prompt, Context: Parent.Context }, { Id: Case.Parent!, Role: "assistant", Text: Parent.Text, CompletionStatus: "completed" }]) }); }
			writeFileSync(join(Directory, Case.Id + "-request.json"), JSON.stringify({ prompt: Prompt, status: "submitting", model: Model.model, effort: Effort, inputItems: 2 }));
			const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: Effort, serviceTier: "default" });
			writeFileSync(join(Directory, Case.Id + "-receipt.json"), JSON.stringify({ threadId: Thread.thread.id, turnId: Turn.turn.id, inferenceSubmissions: 1 }));
			let Timer: ReturnType<typeof setTimeout> | undefined;
			const Completed = Done.get(Turn.turn.id) ?? await new Promise<any>((Resolve, Reject) => { Waiting.set(Turn.turn.id, Resolve); Timer = setTimeout(() => Reject(Error("Result unknown; do not automatically resubmit")), 180000); }).finally(() => { clearTimeout(Timer); Waiting.delete(Turn.turn.id); });
			const Text = [...Texts.get(Turn.turn.id)?.values() ?? []].join("\n\n"); writeFileSync(join(Directory, Case.Id + "-answer.md"), Text);
			const Output = interactive_output(Text, Completed.status === "completed"), Row: any = { id: Case.Id, status: Completed.status, expected: Case.Expected, uiStatus: Output.Status, plots: Output.Spec?.plots.length ?? 0, symbols: Output.Spec?.symbols.length ?? 0 };
			try
			{
				assert.equal(Completed.status, "completed"); assert.ok(Text.trim());
				assert.ok(["none", "ready"].includes(Output.Status), Output.Error);
				if(Case.Expected === "none") { assert.equal(Output.Status, "none"); }
				if(Case.Expected === "no-plots") { assert.equal(Row.plots, 0); }
				if(Case.Expected === "symbols")
				{
					assert.ok(Row.symbols > 0); assert.equal(Row.plots, 0);
					Row.matchedSources = Output.Spec!.symbols.filter(S => locate_symbol(S, [Context!], source_reference(Context!)).Status === "matched").length; assert.ok(Row.matchedSources > 0);
				}
				if(Case.Expected === "plots")
				{
					assert.ok(Row.plots > 0); const Plot = Output.Spec!.plots[0], K = Plot.parameters.find(P => P.name === "k"); assert.ok(K); assert.equal(K.min, 1); assert.equal(K.max, 4); assert.equal(K.step, 1);
					for(const k of [1, 2, 4]) { for(const Point of sample_plot(Plot, { k }, 17)) { assert.ok(Point.y !== null && Math.abs(Point.y - Math.sin(k * Point.x)) < 1e-10); } }
					Row.integerDomainAndSamples = true;
				}
				Row.passed = true;
			}
			catch(E) { Row.passed = false; Row.error = String(E); }
			Answers.set(Case.Id, { Text, Prompt, Context }); Results.push(Row);
			writeFileSync(join(Directory, "report.json"), JSON.stringify({ tier: "real isolated Codex + math-writing; not provider/iPad", model: Model.model, effort: Effort, skillVersion: SkillVersion, inferenceSubmissions: Results.length, cases: Results }, null, 2));
			console.log(JSON.stringify(Row));
		}
		assert.ok(Results.every(R => R.passed), "Policy evaluation failed; inspect saved original results, no automatic retry");
	}
	finally { Connection.close(); }
}
void main().catch(E => { console.error(E); process.exitCode = 1; });
