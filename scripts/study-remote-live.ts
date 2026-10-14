import { mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { RemoteBridge, token_hash } from "../src/bridge";
import { make_task, task_prompt } from "../src/study/task";
import { parse_output } from "../src/study/schema";

async function run_remote()
{
	if(!process.env.CODEX_STUDY_TEST_CLI)
	{
		throw new Error("Set CODEX_STUDY_TEST_CLI; no credentials/configuration are read.");
	}
	const Dir = mkdtempSync(join(tmpdir(), "codex-study-remote-")); cpSync("examples/study", Dir, { recursive: true });
	writeFileSync(join(Dir, "AGENTS.md"), "# Original remote test\nOnly original supplied snapshots, read-only. Do not read private courses, authentication or configuration.\n");
	const Tokens = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
	const Bridge = new RemoteBridge({ Port: 0, Cli: process.env.CODEX_STUDY_TEST_CLI, Cwd: Dir, Vault: "isolated-study-test", ObsidianCli: "obsidian", StateDir: join(Dir, "state"), Clients: Tokens.map((Token, Index) => ({ Id: "device-" + Index, Hash: token_hash(Token) })) });
	const Port = await Bridge.listen();
	const Http = async (Device: number, Path: string, Body?: any) =>
	{
		const Response = await fetch("http://127.0.0.1:" + Port + Path, { method: Body ? "POST" : "GET", headers: { Authorization: "Bearer " + Tokens[Device], "Content-Type": "application/json" }, ...(Body ? { body: JSON.stringify(Body) } : {}) });
		const Data = await Response.json(); assert.equal(Response.status, 200, JSON.stringify(Data)); return Data as any;
	};
	const Rpc = (Method: string, Params: any) => Http(0, "/rpc", { id: crypto.randomUUID(), method: Method, params: Params });
	try
	{
		const Alpha = await Http(0, "/info"); const Beta = await Http(1, "/info"); assert.notEqual(Alpha.client, Beta.client);
		const Source = { Path: "Lie-mini.md", Text: "原创样本: $[h,e]=2e$, $[h,f]=-2f$. 交换子双线性, 输入输出为矩阵. 首次计算 $[h,ae+bf]=2ae-2bf$.", SelectedText: "$[h,e]=2e$", Mode: "阅读" as const, Kind: "选区" as const, Mapping: "源块" as const, LineStart: 0, LineEnd: 0, Heading: "原创新练习", CapturedAt: new Date().toISOString(), Truncated: false };
		const Task = make_task("exercise", Source, "派生一道计算题, 两层可选提示和完整解答. 直接返回 JSON.");
		const Prompt = task_prompt(Task);
		await Http(0, "/state", { state: { Settings: { Model: "gpt-6.1-sol" }, Sessions: [{ Id: "owned-study", Messages: [{ Id: "question", Role: "user", Text: Task.Request, Task, Context: Source, Prompt }] }], ActiveId: "owned-study" }, cursor: 0 });
		const Started = await Rpc("thread/start", { clientSessionId: "owned-study", model: "gpt-6.1-sol", serviceTier: "default", config: { model_reasoning_effort: "low" } });
		const Skill = (await Rpc("skills/list", {})).data[0].skills[0];
		const Turn = await Rpc("turn/start", { threadId: Started.thread.id, model: "gpt-6.1-sol", effort: "low", serviceTier: "default", input: [{ type: "text", text: Prompt }, { type: "skill", name: "math-writing", path: Skill.path }] });
		// Keep client state without TurnId to exercise server-side association and recovery.
		let Cursor = 0; let Completed = false; const Deadline = Date.now() + 180000;
		while(!Completed && Date.now() < Deadline)
		{
			await new Promise(Resolve => setTimeout(Resolve, 700));
			const Events = await Http(0, "/events?after=" + Cursor); Cursor = Events.cursor;
			Completed = Events.events.some((Event: any) => Event.message.method === "turn/completed" && Event.message.params.turn.id === Turn.turn.id && Event.message.params.turn.status === "completed");
		}
		assert.equal(Completed, true);
		const State = await Http(0, "/state"); const Messages = State.state.Sessions[0].Messages;
		const User = Messages.find((Value: any) => Value.Role === "user"); const Reply = Messages.filter((Value: any) => Value.Role === "assistant" && Value.Phase === "final_answer").at(-1);
		assert.equal(User.TurnId, Turn.turn.id); assert.equal(User.Task.Source.Text, Source.Text);
		assert.equal(Reply.CompletionStatus, "completed"); parse_output("exercise", Reply.Text);
		assert.equal((await Http(1, "/state")).state, null);
		const BetaEvents = (await Http(1, "/events?after=0")).events;
		assert.ok(BetaEvents.every((Value: any) => Value.message.params?.threadId !== Started.thread.id));
		const Processes = [...(Bridge as any).Agents.values()].map((Agent: any) => Agent.Connection.Process.pid);
		assert.equal(new Set(Processes).size, 2);
		const Report = { skillVersion: Alpha.mathWritingVersion, inputs: 2, skill: "math-writing", sandbox: "read-only", approvalPolicy: "never", isolatedClients: true, distinctCliProcesses: true, recoveredTaskAndSource: true, finalPhase: Reply.Phase, completionStatus: Reply.CompletionStatus, validatedExercise: true, transport: "loopback HTTP with real app-server", ipadDevice: false };
		writeFileSync(join(Dir, "report.json"), JSON.stringify(Report, null, 2)); process.stdout.write(JSON.stringify({ directory: Dir, report: Report }) + "\n");
	}
	finally
	{
		await Bridge.close();
	}
}
void run_remote().catch(ErrorValue => { process.stderr.write(String(ErrorValue)); process.exitCode = 1; });
