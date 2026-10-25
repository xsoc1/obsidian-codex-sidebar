// One opt-in real loopback bridge request; normal bridge, pairing and daily state are untouched.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { RemoteBridge, token_hash } from "../src/bridge";
import { RemoteConnection, type RemoteConfig } from "../src/remote";
import { CodexConnection } from "../src/rpc";
import { client_instructions, DefaultInstructions, instruction_items, ManagedInstructions } from "../src/prompt";
import { DevelopmentCases } from "../examples/exposition/cases";
import { exposition_input } from "./exposition-input";
import { skill_input } from "../src/skills";
import { reserve_request } from "./exposition-budget";

async function run_live(): Promise<void>
{
	const Directory = process.env.CODEX_EXPOSITION_EVIDENCE, Cli = process.env.CODEX_EXPOSITION_CLI;
	if(!Directory || !Cli || process.env.CODEX_EXPOSITION_REMOTE_LIVE !== "1") { throw new Error("Opt in with evidence directory, CLI and CODEX_EXPOSITION_REMOTE_LIVE=1"); }
	const LedgerPath = join(Directory, "remote-request.json"), ReportPath = join(Directory, "remote-report.json");
	if(existsSync(LedgerPath)) { throw new Error("A remote request already exists; inspect its outcome, no automatic resend"); }
	const Cwd = join(Directory, "remote-workspace"); mkdirSync(Cwd, { recursive: true });
	writeFileSync(join(Cwd, "AGENTS.md"), "# Original remote mathematics acceptance\nRead only. Use only the provided original source and math-writing. Do not read private notes/authentication/configuration or modify any file.\n");
	const Input = await exposition_input(DevelopmentCases.find(Value => Value.Id === "D03")!);
	writeFileSync(join(Cwd, "D03.md"), Input.Source!.Text);
	const Token = randomBytes(32).toString("hex"), Calls: any[] = [];
	const Bridge = new RemoteBridge({ Port: 0, Cli, Cwd, Vault: "original-exposition-fixture", ObsidianCli: "unused", StateDir: join(Directory, "remote-state"), Clients: [{ Id: "original-only", Hash: token_hash(Token) }] }, (Path, Root, Notify, Closed) =>
	{
		const Connection = new CodexConnection(Path, Root, Notify, Closed);
		return { request: async (Method, Params) => { Calls.push({ Method, Params: structuredClone(Params) }); return Connection.request(Method, Params); }, send: Value => Connection.send(Value), close: () => Connection.close() };
	});
	const Port = await Bridge.listen(), Config: RemoteConfig = { Enabled: true, Url: `http://127.0.0.1:${Port}`, Token, Cursor: 0, Server: "" };
	const Http = async (Path: string, Method: string, Body?: unknown) =>
	{
		const Response = await fetch(Config.Url + Path, { method: Method, headers: { Authorization: "Bearer " + Token }, ...(Body === undefined ? {} : { body: JSON.stringify(Body) }) });
		const Data: any = await Response.json(); if(!Response.ok) { throw new Error(Data.error ?? "Remote request failed"); } return Data;
	};
	let Output = "", Resolve!: (Value: any) => void, Reject!: (ErrorValue: Error) => void;
	const Done = new Promise<any>((ResolveValue, RejectValue) => { Resolve = ResolveValue; Reject = RejectValue; }); void Done.catch(() => {});
	let Client = new RemoteConnection(Http, Config, Message =>
	{
		const Params = Message.params;
		if(Message.method === "item/completed" && Params.item.type === "agentMessage" && Params.item.phase !== "commentary") { Output = Params.item.text; }
		if(Message.method === "turn/completed") { Resolve(Params.turn); }
	}, Reject, () => {});
	const Timer = setTimeout(() => Reject(new Error("Remote inference timed out; no retry")), 120000);
	try
	{
		await Client.connect(); Client.start();
		const Session = randomUUID(), Instructions = client_instructions(DefaultInstructions, null);
		const Thread = await Client.request("thread/start", { clientSessionId: Session, model: "gpt-6.1-sol", developerInstructions: Instructions, serviceTier: "default", config: { model_reasoning_effort: "low" } });
		await Client.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(Instructions) });
		const State = { Settings: { Model: "gpt-6.1-sol", Effort: "low", Fast: false }, Sessions: [{ Id: Session, ThreadId: Thread.thread.id, Messages: [{ Id: "original-question", Role: "user", Text: DevelopmentCases.find(Value => Value.Id === "D03")!.Request, Prompt: Input.Prompt, Task: Input.Task, Context: Input.Source }] }], ActiveId: Session };
		await Client.sync_state(State);
		reserve_request(Directory, "remote/D03");
		writeFileSync(LedgerPath, JSON.stringify({ status: "submitting", plannedRequests: 1, sample: "D03", skill: "production-selected 0.2.0; plugin-only", startedAt: new Date().toISOString() }, null, 2));
		await Client.request("turn/start", { threadId: Thread.thread.id, input: skill_input(Input.Prompt, { type: "skill", name: "math-writing", path: "/ignored-client-path/SKILL.md" }), model: "gpt-6.1-sol", effort: "low", serviceTier: "default" });
		const Turn = await Done; assert.equal(Turn.status, "completed"); assert.ok(Output);
		Client.close(); Client = new RemoteConnection(Http, Config, () => {}, Reject, () => {}); await Client.connect();
		const Resume = await Client.request("bridge/resume", { threadId: Thread.thread.id });
		assert.equal(Resume.thread.id, Thread.thread.id); assert.equal(Resume.thread.path, null);
		const Restored = await Http("/state", "GET");
		assert.deepEqual(Restored.state.Sessions[0].Messages[0].Context, Input.Source);
		assert.ok(Restored.state.Sessions[0].Messages.some((Value: any) => Value.Role === "assistant" && Value.Text));
		const Started = Calls.find(Value => Value.Method === "thread/start").Params;
		assert.equal(Started.approvalPolicy, "never"); assert.equal(Started.sandbox, "read-only"); assert.equal(Started.ephemeral, true);
		assert.equal(Started.developerInstructions.split(ManagedInstructions).length - 1, 1);
		const Sent = Calls.find(Value => Value.Method === "turn/start").Params.input;
		assert.equal(Sent.length, 2); assert.notEqual(Sent[1].path, "/ignored-client-path/SKILL.md");
		const SkillVersion = readFileSync(Sent[1].path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1];
		const Report = { status: "completed", sample: "D03", requests: 1, layer: "real loopback HTTP bridge + actual app-server; not Tailscale/iPad", model: "gpt-6.1-sol", effort: "low", serviceTier: "default", skillVersion: SkillVersion, candidateSkill: false, sandbox: Started.sandbox, approvalPolicy: Started.approvalPolicy, inputs: Sent.length, passed: ["host instructions", "server-selected skill", "original Lie explanation", "saved source snapshot", "reconnect/resume", "saved answer"], output: Output };
		writeFileSync(ReportPath, JSON.stringify(Report, null, 2)); writeFileSync(LedgerPath, JSON.stringify({ ...Report, output: undefined, finishedAt: new Date().toISOString() }, null, 2));
		process.stdout.write(JSON.stringify({ status: Report.status, sample: "D03", skillVersion: SkillVersion, passed: Report.passed }) + "\n");
	}
	catch(ErrorValue) { writeFileSync(join(Directory, "remote-failure.json"), JSON.stringify({ error: String(ErrorValue), output: Output }, null, 2)); throw ErrorValue; }
	finally { clearTimeout(Timer); Client.close(); await Bridge.close(); }
}

void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
