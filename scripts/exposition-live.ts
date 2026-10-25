// Opt-in paired inference on original sources; no daily plugin/bridge/skill mutations.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DevelopmentCases, HoldoutCases, type ExpositionCase } from "../examples/exposition/cases";
import { exposition_input } from "./exposition-input";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { skill_input, type SkillInput } from "../src/skills";
import * as CandidatePrompt from "../src/prompt";
import * as CandidateTask from "../src/edit/task";
import { history_items } from "../src/history";
import { parse_edit } from "../src/edit/protocol";
import { parse_completion, MathCompletionInstructions } from "../src/completion";
import { reserve_request } from "./exposition-budget";

const hash = (Text: string | Buffer) => createHash("sha256").update(Text).digest("hex");

function skill_fingerprint(Root: string): string
{
	const Files: { path: string; hash: string }[] = [];
	function visit(Directory: string, Prefix: string): void
	{
		for(const Entry of readdirSync(Directory, { withFileTypes: true }).sort((Left, Right) => Left.name.localeCompare(Right.name)))
		{
			if(Entry.isSymbolicLink()) { throw new Error("Skill evaluation requires owned regular files"); }
			const Path = join(Directory, Entry.name), Name = Prefix + Entry.name;
			if(Entry.isDirectory()) { visit(Path, Name + "/"); }
			else { Files.push({ path: Name, hash: hash(readFileSync(Path)) }); }
		}
	}
	visit(Root, "");
	return hash(JSON.stringify(Files));
}

async function run_live(): Promise<void>
{
	const Cli = process.env.CODEX_EXPOSITION_CLI, Directory = process.env.CODEX_EXPOSITION_EVIDENCE, Baseline = process.env.CODEX_EXPOSITION_BASELINE;
	if(!Cli || !Directory || !Baseline) { throw new Error("Set CODEX_EXPOSITION_CLI, CODEX_EXPOSITION_EVIDENCE and CODEX_EXPOSITION_BASELINE; no credentials are read."); }
	const Stage = process.env.CODEX_EXPOSITION_STAGE ?? "discover";
	if(!["discover", "development", "holdout"].includes(Stage)) { throw new Error("Unknown evaluation stage"); }
	const Run = process.env.CODEX_EXPOSITION_RUN ?? "initial";
	if(!/^[a-z0-9-]{1,24}$/.test(Run)) { throw new Error("Invalid run label"); }
	const OldPrompt = await import(pathToFileURL(join(Baseline, "src/prompt.ts")).href);
	const OldTask = await import(pathToFileURL(join(Baseline, "src/study/task.ts")).href);
	const OldCompletion = await import(pathToFileURL(join(Baseline, "src/completion.ts")).href);
	if(OldPrompt.DefaultInstructions !== CandidatePrompt.V0111DefaultInstructions) { throw new Error("Frozen default does not match the actual baseline"); }
	let Samples = Stage === "holdout" ? HoldoutCases : DevelopmentCases.filter(Value => ["D02", "D04", "D08", "D14"].includes(Value.Id));
	if(process.env.CODEX_EXPOSITION_IDS)
	{
		const Ids = process.env.CODEX_EXPOSITION_IDS.split(",");
		if(Stage !== "development" || Ids.some(Id => !Samples.some(Value => Value.Id === Id))) { throw new Error("Only explicit development cases can be selected"); }
		Samples = Samples.filter(Value => Ids.includes(Value.Id));
	}
	const Variants = (process.env.CODEX_EXPOSITION_VARIANTS ?? "baseline,candidate").split(",");
	if(Variants.some(Value => !["baseline", "candidate"].includes(Value)) || new Set(Variants).size !== Variants.length) { throw new Error("Invalid evaluation variants"); }
	if(Stage === "holdout" && Variants.join(",") !== "baseline,candidate") { throw new Error("Holdout requires complete pairs"); }
	const FreezePath = join(Directory, Run === "initial" ? "evaluation-freeze.json" : "evaluation-freeze-" + Run + ".json");
	const PromptHashes = await Promise.all([...DevelopmentCases, ...HoldoutCases].map(async Sample => ({ id: Sample.Id, baseline: hash((await exposition_input(Sample, { build_prompt: OldPrompt.build_prompt, task_prompt: OldTask.task_prompt })).Prompt), candidate: hash((await exposition_input(Sample)).Prompt) })));
	const Freeze = { schemaVersion: 2, baseline: hash(OldPrompt.DefaultInstructions), candidate: hash(CandidatePrompt.DefaultInstructions), inputs: hash(JSON.stringify([...DevelopmentCases, ...HoldoutCases])), effectivePrompts: PromptHashes, rubric: hash(readFileSync("tests/fixtures/exposition-rubric.json")), baselineSkill: skill_fingerprint(join(Directory, "baseline-workspace/.agents/skills/math-writing")), candidateSkill: skill_fingerprint(join(Directory, "candidate-workspace/.agents/skills/math-writing")) };
	if(existsSync(FreezePath) && readFileSync(FreezePath, "utf8") !== JSON.stringify(Freeze, null, 2)) { throw new Error("Evaluation inputs/rules changed since freeze; preserve prior run and explicitly version a new freeze"); }
	if(!existsSync(FreezePath)) { writeFileSync(FreezePath, JSON.stringify(Freeze, null, 2)); }
	const LedgerPath = join(Directory, "request-ledger.json");
	const Ledger: any[] = existsSync(LedgerPath) ? JSON.parse(readFileSync(LedgerPath, "utf8")) : [];
	if(Stage === "holdout" && ["D02", "D04", "D08", "D14"].some(Id => ["baseline", "candidate"].some(Variant => !Ledger.some(Value => Value.id === Id && Value.variant === Variant && Value.stage === "development" && Value.status === "completed")))) { throw new Error("Finish and review the four development pairs before holdout"); }
	if(Stage === "holdout" && !existsSync(join(Directory, "development-reviewed.json"))) { throw new Error("Record the development review before holdout"); }
	const Discoveries: any[] = [];
	for(const Variant of Variants)
	{
		const Cwd = join(Directory, Variant + "-workspace");
		const Done = new Map<string, any>(), Waiters = new Map<string, (Value: any) => void>(), Texts = new Map<string, string>(), Commands: { turnId: string; item: unknown }[] = [];
		let Connection: CodexConnection;
		Connection = new CodexConnection(Cli, Cwd, (Message: RpcMessage) =>
		{
			if(Message.id !== undefined && Message.method) { Connection.send({ id: Message.id, error: { code: -32601, message: "No extra tools or approvals in the exposition evaluation" } }); return; }
			const Params = Message.params;
			if(Message.method === "item/completed" && Params.item.type === "commandExecution") { Commands.push({ turnId: Params.turnId, item: Params.item }); }
			if(Message.method === "item/completed" && Params.item.type === "agentMessage" && Params.item.phase !== "commentary") { Texts.set(Params.turnId, Params.item.text); }
			if(Message.method === "turn/completed") { Done.set(Params.turn.id, Params.turn); Waiters.get(Params.turn.id)?.(Params.turn); }
		}, ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); });
		try
		{
			await Connection.request("initialize", { clientInfo: { name: "obsidian_exposition_evaluation", version: "1" }, capabilities: { experimentalApi: true } });
			Connection.send({ method: "initialized", params: {} });
			const Found = await Connection.request("skills/list", { cwds: [Cwd], forceReload: true });
			const Expected = resolve(Cwd, ".agents/skills/math-writing/SKILL.md");
			const Skills = (Found.data ?? []).flatMap((Value: any) => Value.skills ?? []);
			const Selected = Skills.find((Value: any) => Value.enabled && Value.name === "math-writing" && resolve(Value.path).toLowerCase() === Expected.toLowerCase());
			if(!Selected || !Expected.startsWith(resolve(Cwd) + sep)) { writeFileSync(join(Directory, Variant + "-discovery-private.json"), JSON.stringify(Found, null, 2)); throw new Error("Owned skill candidate was not discovered; no inference submitted"); }
			const Skill: SkillInput = { type: "skill", name: "math-writing", path: Selected.path };
			const SkillText = readFileSync(Skill.path, "utf8");
			const Models = (await Connection.request("model/list", { limit: 100, includeHidden: false })).data;
			const Model = Models.find((Value: any) => Value.model === (process.env.CODEX_EXPOSITION_MODEL ?? "gpt-6.1-sol"));
			if(!Model?.supportedReasoningEfforts?.some((Value: any) => Value.reasoningEffort === "low")) { throw new Error("The fixed model/low combination is unavailable"); }
			Discoveries.push({ variant: Variant, path: Skill.path, scope: Selected.scope, sha256: hash(SkillText), version: SkillText.match(/version:\s*"?([^"\r\n]+)/)?.[1], model: Model.model, effort: "low", serviceTier: "default" });
			writeFileSync(join(Directory, "discovery-private.json"), JSON.stringify(Discoveries, null, 2));
			if(Stage === "discover") { continue; }
			for(const Sample of Samples)
			{
				const Existing = Ledger.find(Value => Value.variant === Variant && Value.id === Sample.Id && (Value.run ?? "initial") === Run);
				if(Existing?.status === "completed") { continue; }
				if(Existing) { throw new Error("Refusing an implicit retry or duplicate; inspect the ledger first"); }
				if(Ledger.length >= 28) { throw new Error("Evaluation request budget exhausted"); }
				const Builders = Variant === "baseline" ? { build_prompt: OldPrompt.build_prompt, task_prompt: OldTask.task_prompt } : { build_prompt: CandidatePrompt.build_prompt, task_prompt: CandidateTask.task_prompt };
				const Input = await exposition_input(Sample, Builders);
				if(Sample.Source) { writeFileSync(join(Cwd, Sample.Id + ".md"), Sample.Source); }
				const Instructions = Sample.Action === "completion" ? Variant === "baseline" ? OldCompletion.CompletionInstructions : MathCompletionInstructions : Variant === "baseline" ? OldPrompt.DefaultInstructions : CandidatePrompt.DefaultInstructions;
				const Thread = await Connection.request("thread/start", { cwd: Cwd, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model, developerInstructions: Instructions });
				if(Thread.thread.path || Thread.thread.ephemeral !== true) { throw new Error("Server did not return an ephemeral thread"); }
				await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: CandidatePrompt.instruction_items(Instructions) });
				if(Sample.History) { await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: history_items(Sample.History.map((Value, Index) => ({ ...Value, Id: String(Index) }))) }); }
				const Entry: any = { id: Sample.Id, variant: Variant, run: Run, stage: Stage, status: "submitting", startedAt: new Date().toISOString(), model: Model.model, effort: "low", serviceTier: "default", skillSha256: hash(SkillText), instructionsSha256: hash(Instructions) };
				reserve_request(Directory, `${Run}/${Variant}/${Sample.Id}`);
				Ledger.push(Entry); writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2));
				process.stdout.write(JSON.stringify({ id: Sample.Id, variant: Variant, status: "starting" }) + "\n");
				try
				{
					const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: skill_input(Input.Prompt, Skill), model: Model.model, effort: "low", serviceTier: "default" });
					Entry.turnId = Turn.turn.id; Entry.status = "inProgress"; writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2));
					let Timer: ReturnType<typeof setTimeout> | undefined;
					const Completed = Done.get(Turn.turn.id) ?? await new Promise<any>((Resolve, Reject) => { Timer = setTimeout(() => Reject(new Error("Inference timeout; result may still be in progress; no automatic resend")), 180000); Waiters.set(Turn.turn.id, Resolve); }).finally(() => { clearTimeout(Timer); Waiters.delete(Turn.turn.id); });
					const Output = Texts.get(Turn.turn.id) ?? "";
					writeFileSync(join(Directory, Variant + (Run === "initial" ? "" : "-" + Run) + "-" + Sample.Id + ".json"), JSON.stringify({ entry: Entry, input: Input, output: Output, turnStatus: Completed.status, commands: Commands.filter(Value => Value.turnId === Turn.turn.id) }, null, 2));
					if(Completed.status !== "completed" || !Output) { throw new Error("Inference did not complete with a final answer"); }
					if(Sample.Action === "edit") { parse_edit(Output); }
					else if(Sample.Action === "completion") { parse_completion(Output); }
					Entry.status = "completed"; Entry.outputSha256 = hash(Output);
				}
				catch(ErrorValue) { Entry.status = "failed"; Entry.error = String(ErrorValue); throw ErrorValue; }
				finally { Entry.finishedAt = new Date().toISOString(); writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2)); }
				process.stdout.write(JSON.stringify({ id: Sample.Id, variant: Variant, status: Entry.status }) + "\n");
			}
		}
		finally { Connection.close(); }
	}
}

void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
