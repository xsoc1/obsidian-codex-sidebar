// Opt-in real inference on original fixtures only; an unknown result is never resubmitted.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { discover_app_codex } from "../src/launch";
import { math_writing_skill, skill_input } from "../src/skills";
import { build_prompt, DefaultInstructions, snapshot_instructions, instruction_items, type ContextSnapshot } from "../src/prompt";
import { interactive_output } from "../src/interactive/protocol";
import { answer_quote } from "../src/quote";
import { explanation_draft } from "../src/explanation-actions";
import { source_reference } from "../src/sources";
import { locate_symbol } from "../src/interactive/symbols";
import { ProductVersion } from "../src/version";

async function main()
{
	if(process.env.CODEX_STRUCTURE_LIVE !== "1") { throw Error("Set CODEX_STRUCTURE_LIVE=1 for two real inference requests"); }
	const Cli = process.env.CODEX_STRUCTURE_CLI || discover_app_codex(process.env.LOCALAPPDATA!); assert.ok(Cli);
	const Directory = mkdtempSync(join(tmpdir(), "codex-structure-live-")), Workspace = join(Directory, "workspace"); mkdirSync(Workspace);
	const Source = "# 原创对偶映射微型样例\n\n设 $V,W$ 为实向量空间, $T:V\\to W$ 为线性映射.\n\n记 $V^*=\\operatorname{Hom}_{\\mathbb R}(V,\\mathbb R)$, $W^*=\\operatorname{Hom}_{\\mathbb R}(W,\\mathbb R)$.\n\n对 $\\lambda\\in W^*$, 定义 $T^*\\lambda=\\lambda\\circ T$. 因此 $T^*:W^*\\to V^*$.\n\n核验路线: 先检查复合的定义域与值域; 再对 $v_1,v_2\\in V$, $a,b\\in\\mathbb R$ 展开 $(T^*\\lambda)(av_1+bv_2)$, 分别使用 $T$ 和 $\\lambda$ 的线性. 这里的对偶为代数对偶, 没有加入范数或连续性假设.\n";
	writeFileSync(join(Workspace, "original.md"), Source);
	writeFileSync(join(Workspace, "AGENTS.md"), "# Isolated original acceptance\nRead only the supplied original snapshot and enabled math-writing. Read-only, no private notes, auth/config, shell or file changes.\n");
	const Context: ContextSnapshot = { Path: "original.md", Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text: Source, SelectedText: "", LineStart: 0, LineEnd: Source.split("\n").length - 1, Heading: "原创对偶映射微型样例", CapturedAt: new Date().toISOString(), Truncated: false };
	const Done = new Map<string, any>(), Answers = new Map<string, string>(), Waiting = new Map<string, (T: any) => void>();
	const Connection = new CodexConnection(Cli, Workspace, (M: RpcMessage) =>
	{
		if(M.id !== undefined && M.method) { Connection.send({ id: M.id, error: { code: -32601, message: "No additional tools/approvals" } }); return; }
		const P = M.params;
		if(M.method === "item/completed" && P.item.type === "agentMessage" && P.item.phase !== "commentary") { Answers.set(P.turnId, (Answers.get(P.turnId) ?? "") + P.item.text); }
		if(M.method === "turn/completed") { Done.set(P.turn.id, P.turn); Waiting.get(P.turn.id)?.(P.turn); }
	}, E => process.stderr.write(String(E) + "\n"));
	console.log(JSON.stringify({ directory: Directory }));
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_structure_acceptance", version: ProductVersion }, capabilities: { experimentalApi: true } }); Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Workspace], forceReload: true }), Workspace);
		const SkillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1] ?? "unconfirmed";
		const Models = (await Connection.request("model/list", { limit: 100, includeHidden: false })).data, Model = Models.find((M: any) => M.isDefault) ?? Models[0]; assert.ok(Model);
		const Effort = Model.supportedReasoningEfforts.find((E: any) => E.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Thread = await Connection.request("thread/start", { cwd: Workspace, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model }); assert.equal(Thread.thread.path, null);
		await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(snapshot_instructions(DefaultInstructions, "只使用原创快照与当前原回答, 没有读库工具.")) });
		async function run(Name: string, Prompt: string)
		{
			const Input = skill_input(Prompt, Skill); assert.equal(Input.length, 2);
			writeFileSync(join(Directory, Name + "-request.json"), JSON.stringify({ prompt: Prompt, model: Model.model, effort: Effort, inputItems: 2, status: "submitting-once" }, null, 2));
			const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: Effort, serviceTier: "default" });
			writeFileSync(join(Directory, Name + "-receipt.json"), JSON.stringify({ threadId: Thread.thread.id, turnId: Turn.turn.id }));
			let Timer: ReturnType<typeof setTimeout>;
			const Result = Done.get(Turn.turn.id) ?? await new Promise<any>((R, Reject) => { Waiting.set(Turn.turn.id, R); Timer = setTimeout(() => Reject(Error("Timed out; reconcile the original turn, never auto-resubmit")), 180000); }).finally(() => { clearTimeout(Timer); Waiting.delete(Turn.turn.id); });
			const Text = Answers.get(Turn.turn.id) ?? ""; writeFileSync(join(Directory, Name + "-answer.md"), Text); assert.equal(Result.status, "completed"); return Text;
		}
		const First = await run("structures", build_prompt("我总把原映射与对偶映射的方向混淆. 请沿核验路线给出完整说明, 附一个可点对象的关系图, 再附一组逐步对照线性的推导步骤. 节点/步骤有对应原文时逐字引用. 正文先给完整证明, 不写笔记.", Context));
		const Parsed = interactive_output(First, true); assert.equal(Parsed.Status, "ready", Parsed.Error);
		assert.ok(Parsed.Spec?.relations?.length); assert.ok(Parsed.Spec?.walkthroughs?.length);
		const Items = [...Parsed.Spec.relations.flatMap(R => R.nodes), ...Parsed.Spec.walkthroughs.flatMap(W => W.steps)];
		const Locations = Items.map(S => ({ id: S.id, ...locate_symbol(S, [Context], source_reference(Context)) })); assert.ok(Locations.some(L => L.Status === "matched"));
		const Original = { Id: "original-answer", Role: "assistant" as const, Text: First };
		const Quote = answer_quote("original-session", Original.Id, "对偶映射", First, "completed", { SourcePath: Context.Path, SourceReferences: source_reference(Context) });
		const Draft = explanation_draft("plain", Quote, "original-session", [Original], "", null);
		const Followup = await run("plain-followup", build_prompt(Draft.Question, null, Draft.Quote));
		assert.ok(Followup.includes("整合后的完整说明"));
		const Report = { tier: "two actual isolated Codex app-server turns with explicit math-writing; not iPad or paid API", version: ProductVersion, model: Model.model, effort: Effort, skillVersion: SkillVersion, inferenceSubmissions: 2, inputItemsEach: 2, uiStatus: Parsed.Status, relations: Parsed.Spec.relations.length, walkthroughs: Parsed.Spec.walkthroughs.length, matchedQuotes: Locations.filter(L => L.Status === "matched").length, integratedFollowup: true };
		writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify(Report));
	}
	finally { Connection.close(); }
}
void main().catch(E => { console.error(E); process.exitCode = 1; });
