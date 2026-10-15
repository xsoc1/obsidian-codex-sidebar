// Opt-in real model request with original material and an in-memory write host.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { DefaultInstructions, instruction_items, type ContextSnapshot } from "../src/prompt";
import { task_prompt, type TaskSpec } from "../src/study/task";
import { version_of } from "../src/study/document";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";

async function run_live(): Promise<void>
{
	const Cli = process.env.CODEX_EDIT_TEST_CLI;
	const Scope = process.env.CODEX_EDIT_SCOPE === "ai" ? "ai" : "captured";
	if(!Cli) { throw new Error("Set CODEX_EDIT_TEST_CLI to the installed CLI. No authentication file is read."); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-edit-live-"));
	const Before = readFileSync("examples/study/Edit-mini.md", "utf8").replace(/\r\n/g, "\n");
	const Paragraph = Before.split("\n\n").find(Value => Value.startsWith("证明:"))!;
	writeFileSync(join(Directory, "AGENTS.md"), "# Original note-edit acceptance\nRead only. Use the supplied original source snapshot. Do not access private notes or change files/config/authentication.\n");
	const Texts = new Map<string, string>(), Done = new Map<string, any>(), Waiters = new Map<string, (Value: any) => void>();
	let Connection: CodexConnection;
	function notification(Value: RpcMessage): void
	{
		if(Value.id !== undefined && Value.method) { Connection.send({ id: Value.id, error: { code: -32601, message: "No write approvals or extra tools in this acceptance" } }); return; }
		const Params = Value.params;
		if(Value.method === "item/completed" && Params.item.type === "agentMessage" && Params.item.phase !== "commentary") { Texts.set(Params.turnId, Params.item.text); }
		if(Value.method === "turn/completed") { Done.set(Params.turn.id, Params.turn); Waiters.get(Params.turn.id)?.(Params.turn); }
	}
	Connection = new CodexConnection(Cli, Directory, notification, ErrorValue => process.stderr.write(String(ErrorValue)));
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_note_edit_acceptance", version: "0.9.0" }, capabilities: { experimentalApi: true } });
		Connection.send({ method: "initialized", params: {} });
		assert.ok((await Connection.request("account/read", { refreshToken: false })).account);
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		const SkillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1].trim() ?? "unconfirmed";
		const Models = await Connection.request("model/list", { limit: 100, includeHidden: false });
		const Model = Models.data.find((Value: any) => Value.model === "gpt-6.1-sol") ?? Models.data.find((Value: any) => Value.isDefault);
		assert.ok(Model); const Effort = Model.supportedReasoningEfforts.find((Value: any) => Value.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Thread = await Connection.request("thread/start", { cwd: Directory, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model });
		assert.equal(Thread.thread.path, null);
		await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(DefaultInstructions) });
		const Local = new Map<string, string>(), Store = new EditStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "original-only");
		let Current = Before, Writes = 0, Output = "", Spec: TaskSpec;
		const Controller = new ChatEdits(Store, {
			read_current: async () => Current,
			compare_write: async (_, Expected, Next) => { assert.equal(Current, Expected); Current = Next; Writes++; }, protected_source: () => false, changed: () => {},
			send: async Task =>
			{
				Spec = Task;
				const Input = skill_input(task_prompt(Task), Skill); assert.equal(Input.length, 2);
				const Result = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: Effort, serviceTier: "default" });
				const Turn = Done.get(Result.turn.id) ?? await new Promise<any>((Resolve, Reject) =>
				{
					const Timer = setTimeout(() => Reject(new Error("Real model timed out; no retry")), 120000);
					Waiters.set(Result.turn.id, Value => { clearTimeout(Timer); Resolve(Value); });
				});
				assert.equal(Turn.status, "completed"); Output = Texts.get(Result.turn.id)!;
				await Controller.accept_result(Task.Id, Output, true); return true;
			}
		});
		const Focus = Scope === "ai" ? Before.split("\n\n")[1] : Paragraph, From = Before.indexOf(Focus);
		const Source: ContextSnapshot = { Path: "Edit-mini.md", Mode: "编辑", Kind: "选区", Mapping: "源文本", Text: Before, SelectedText: Focus, Selection: { From, To: From + Focus.length }, LineStart: 0, LineEnd: Before.split("\n").length - 1, Heading: "证明", CapturedAt: new Date().toISOString(), Version: await version_of(Before), Truncated: false };
		await Controller.request("请修正这份笔记中交换子计算的最后系数错误, 只作最小改动, 保留原句式和路线, 由你选择所需修改范围.", Source, Scope, "complete-answer");
		writeFileSync(join(Directory, "model-output-private.json"), JSON.stringify({ before: Before, output: Output, task: Spec! }, null, 2));
		assert.equal(Writes, 0); assert.equal(Current, Before); const Plan = Store.Data.Writes[0]; assert.ok(Plan);
		assert.equal(Plan.After, Before.replace("[h,e]=he-eh=e", "[h,e]=he-eh=2e"));
		await Promise.all([Controller.confirm(Plan.Id), Controller.confirm(Plan.Id)]); assert.equal(Writes, 1);
		await Controller.undo(Plan.Id); assert.equal(Current, Before);
		const Replay = Controller.replay(Spec!); Controller.register(Replay); await Controller.accept_result(Replay.Id, Output, true);
		Current += "\n后续编辑"; await assert.rejects(Controller.confirm(Store.Data.Writes.at(-1)!.Id), /陈旧/);
		if(Scope === "ai") { assert.ok(Plan.Target.Range!.From > Source.Selection!.To); }
		const Report = { scope: Scope, model: Model.model, effort: Effort, skillVersion: SkillVersion, inputs: 2, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", passed: ["real completed model edit", "runtime schema", "minimal coefficient correction", "zero pre-confirm writes", "duplicate confirm", "safe undo", "stale rejection"], host: "in-memory; native host checked separately" };
		writeFileSync(join(Directory, "result-private.json"), JSON.stringify({ before: Before, output: Output, task: Spec!, report: Report }, null, 2));
		process.stdout.write(JSON.stringify({ directory: Directory, report: Report }) + "\n");
	}
	finally { Connection.close(); }
}
void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
