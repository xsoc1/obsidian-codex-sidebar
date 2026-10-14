// Opt-in real-model acceptance. All notes/state live in a new temporary directory.
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { make_task, task_prompt } from "../src/study/task";
import { DefaultInstructions, instruction_items } from "../src/prompt";
import { StudyStore } from "../src/study/store";
import { StudyController } from "../src/study/controller";
import { bind_target } from "../src/study/writer";
import { block_ids } from "../src/study/document";
import assert from "node:assert/strict";

async function run_live()
{
	const Cli = process.env.CODEX_STUDY_TEST_CLI;
	if(!Cli)
	{
		throw new Error("Set CODEX_STUDY_TEST_CLI to the installed CLI; no authentication file is read.");
	}
	const Directory = mkdtempSync(join(tmpdir(), "codex-study-live-"));
	cpSync("examples/study", Directory, { recursive: true });
	writeFileSync(join(Directory, "AGENTS.md"), "# Isolated original mathematics test\nOnly the original demo notes in this directory are reference sources. Do not write files, change authentication/configuration, or read private course material. Use the supplied source snapshot.\n");
	const Done = new Map<string, any>(); const Waiters = new Map<string, (Value: any) => void>();
	const Texts = new Map<string, string>(); const Calls: { action: string; inputs: number; skill: string }[] = [];
	const Local = new Map<string, string>(); const Files = new Map<string, string>();
	for(const Path of ["Lie-mini.md", "Analysis-mini.md"])
	{
		Files.set(Path, readFileSync(join(Directory, Path), "utf8"));
	}
	let Connection: CodexConnection;
	function notification(Value: RpcMessage)
	{
		if(Value.id !== undefined && Value.method)
		{
			Connection.send({ id: Value.id, error: { code: -32601, message: "No privileged approvals in acceptance" } }); return;
		}
		const Params = Value.params;
		if(Value.method === "item/completed" && Params.item.type === "agentMessage")
		{
			Texts.set(Params.turnId, Params.item.text);
		}
		if(Value.method === "turn/completed")
		{
			Done.set(Params.turn.id, Params.turn); Waiters.get(Params.turn.id)?.(Params.turn);
		}
	}
	Connection = new CodexConnection(Cli, Directory, notification, ErrorValue => { process.stderr.write(String(ErrorValue)); });
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_study_acceptance", version: "0.7.0-study" }, capabilities: { experimentalApi: true } });
		Connection.send({ method: "initialized", params: {} });
		const Account = await Connection.request("account/read", { refreshToken: false }); assert.ok(Account.account);
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		const SkillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1].trim() ?? "unconfirmed";
		const Models = await Connection.request("model/list", { limit: 100, includeHidden: false });
		const Model = Models.data.find((Value: any) => Value.model === "gpt-6.1-sol") ?? Models.data.find((Value: any) => Value.isDefault);
		const Effort = Model.supportedReasoningEfforts.find((Value: any) => Value.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Thread = await Connection.request("thread/start", { cwd: Directory, model: Model.model, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", config: { model_reasoning_effort: Effort } });
		assert.equal(Thread.thread.ephemeral, true); assert.equal(Thread.thread.path, null);
		await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(DefaultInstructions) });
		const Store = new StudyStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "isolated-original");
		const Controller = new StudyController(Store, {
			read_current: async Path => Files.get(Path) ?? null,
			compare_write: async (Path, Before, After) => { assert.equal(Files.get(Path) ?? null, Before); Files.set(Path, After); },
			suppress_completion: () => {}, changed: () => {},
			send_task: async Task =>
			{
				const Input = skill_input(task_prompt(Task), Skill); Calls.push({ action: Task.Action, inputs: Input.length, skill: Input[1].name });
				const Result = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: Effort, serviceTier: "default" });
				const Turn = Done.get(Result.turn.id) ?? await new Promise(Resolve => Waiters.set(Result.turn.id, Resolve));
				writeFileSync(join(Directory, `${Task.Action}-raw.txt`), Texts.get(Result.turn.id) ?? "");
				await Controller.accept_result(Task, Texts.get(Result.turn.id) ?? "", (Turn as any).status === "completed");
				writeFileSync(join(Directory, "results-private.json"), JSON.stringify(Store.Data, null, 2));
				process.stdout.write(`completed ${Task.Action}\n`); return true;
			}
		});
		const Source = { Path: "Lie-mini.md", Mode: "阅读" as const, Kind: "选区" as const, Mapping: "源块" as const, Text: Files.get("Lie-mini.md")!.split("^lie-commutator")[0], SelectedText: "$[h,e]=2e$", Heading: "次序", LineStart: 6, LineEnd: 35, CapturedAt: new Date().toISOString(), Truncated: false };
		await Controller.send(make_task("explain", Source, "直接解释 $[h,e]=2e$ 的两次矩阵乘法, 不反问."));
		await Controller.send(make_task("exercise", Source, "只派生题目: 计算 $[h,2e+f]$. 三个渐进提示, 完整解答."));
		assert.ok(Controller.Exercise); Controller.hint(); await Controller.attempt("直接乘矩阵: $h(2e+f)=2e-f$, $(2e+f)h=-2e+f$, 相减得 $4e-2f$. 我没有使用双线性公式.");
		assert.equal(Controller.Exercise!.Attempts[0].Feedback!.verdict, "correct"); Controller.reveal();
		const Sample = make_task("sample", Source, "明确请求原创讲义新写: 写一节完整样章, 沿矩阵交换子到双线性用途, 不挖空, 不超过 1200 字.");
		Sample.Writing = { Sources: "原创 Lie-mini 中本次快照", Endpoint: "李括号计算; 已知矩阵乘法, 不熟嵌套记号", Spine: "两次乘法的差及双线性用途", ContentMap: "保留第一次完整计算与定义; 理想留到下一节" };
		Sample.Target = await bind_target(Controller.Host, "new-lecture.md", "create", null);
		assert.equal(await Controller.send(Sample), true, Controller.Error); const Create = Store.Data.Writes.at(-1)!;
		assert.equal(Files.has("new-lecture.md"), false); await Controller.Writer.confirm(Create.Id); assert.ok(Files.has("new-lecture.md"));
		const Id = block_ids(Create.After).at(-1)!;
		const Proposal = make_task("proposal", { ...Source, Path: "new-lecture.md", Text: Create.After }, "明确为讲义新增一节: 说明交换子不满足结合律并给完整反例计算. 仅在指定单元之后插入, 不超过 600 字.");
		Proposal.Target = await bind_target(Controller.Host, "new-lecture.md", "insert-after", Id);
		assert.equal(await Controller.send(Proposal), true, Controller.Error); const Plan = Store.Data.Writes.at(-1)!;
		Files.set("new-lecture.md", Create.After + "\n用户的后续编辑"); await assert.rejects(Controller.Writer.confirm(Plan.Id), /陈旧/);
		Files.set("new-lecture.md", Create.After);
		const Fresh = { ...structuredClone(Proposal), Id: crypto.randomUUID() }; Fresh.Target = await bind_target(Controller.Host, "new-lecture.md", "insert-after", Id);
		Controller.register_task(Fresh); await Controller.accept_result(Fresh, Store.Data.Tasks.find(Value => Value.Spec.Id === Proposal.Id)!.Response!, true);
		await Controller.Writer.confirm(Store.Data.Writes.at(-1)!.Id); await Controller.Writer.undo(Store.Data.Writes.at(-1)!.Id);
		const Report = { skillVersion: SkillVersion, model: Model.model, effort: Effort, serviceTier: "default", ephemeral: true, approvalPolicy: "never", calls: Calls, passed: ["real explain", "real exercise", "alternative correct method", "graded hint/reveal", "real sample and preview", "confirmed create (memory host)", "real proposal", "stale refusal", "fresh apply and safe undo (memory host)"], nativeClient: false };
		writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2));
		process.stdout.write(JSON.stringify({ directory: Directory, report: Report }) + "\n");
	}
	finally
	{
		Connection.close();
	}
}
void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
