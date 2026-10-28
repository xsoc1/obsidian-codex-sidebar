// Opt-in single-inference acceptance. All bridge/state/workspace files are owned TEMP fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RemoteBridge, token_hash, type BridgeConfig } from "../src/bridge";
import { RemoteConnection, type RemoteConfig, type RpcConnection } from "../src/remote";
import { CodexConnection } from "../src/rpc";
import { discover_cli, runtime_info } from "../src/desktop";
import { resolve_codex_executable } from "../src/launch";
import { ProductVersion } from "../src/version";
import { DefaultInstructions, client_instructions, instruction_items, build_prompt, derived_message_prompt, type ContextSnapshot } from "../src/prompt";
import { build_history_input } from "../src/history-budget";
import { answer_quote } from "../src/quote";
import { text_identity } from "../src/markdown-blocks";
import type { ChatMessage } from "../src/history";
import { skill_input, math_writing_skill, type SkillInput } from "../src/skills";
import { content_digest } from "../src/sync/types";
import { create_send_operation } from "../src/sync/operations";
import { write_state_file } from "../src/runtime/state-store";
import { version_of } from "../src/edit/document";

export function live_answer_text(Message: any): string | null
{
	if(Message?.method === "bridge/message-updated" && Message.params?.message?.Role === "assistant" && Message.params.message.Phase !== "commentary" && typeof Message.params.message.Text === "string") { return Message.params.message.Text; }
	if(Message?.method === "item/completed" && Message.params?.item?.type === "agentMessage" && Message.params.item.phase !== "commentary" && typeof Message.params.item.text === "string") { return Message.params.item.text; }
	return null;
}

async function recover_live(Directory: string, Ledger: any): Promise<void>
{
	if(!Ledger.attempted || Ledger.inferenceSubmissions !== 1 || typeof Ledger.operationId !== "string") { throw new Error("Recovery requires the existing single submitted operation ledger; never starts inference"); }
	const Failure = JSON.parse(readFileSync(join(Directory, "report.json"), "utf8")), Local = JSON.parse(readFileSync(join(Directory, "client-state-v2.json"), "utf8"));
	const Cwd = join(Directory, "original-workspace"), Cli = resolve_codex_executable(process.env.CODEX_ROUND2_CLI || await discover_cli()), Runtime = await runtime_info(Cli);
	assert.equal(Runtime.Complete, true);
	let ServerSkill: SkillInput | null = null, NewSubmissions = 0, Closing = false;
	const Factory = (Path: string, Root: string, Notify: (M: any) => void, Closed: (E: Error) => void): RpcConnection =>
	{
		const C = new CodexConnection(Path, Root, Notify, E => { if(!Closing) { Closed(E); } });
		return { request: async (Method, Params) => { if(Method === "turn/start") { NewSubmissions++; throw new Error("Read-only recovery refuses all inference submissions"); } const Result = await C.request(Method, Params); if(Method === "skills/list") { ServerSkill = math_writing_skill(Result, Cwd); } return Result; }, send: M => C.send(M), close: () => C.close() };
	};
	const Token = randomBytes(32).toString("hex"), Bridge = new RemoteBridge({ Port: 0, Cli, Cwd, Vault: "original-reliability-fixture", ObsidianCli: "not-used-original-fixture", StateDir: join(Directory, "isolated-bridge-state"), Clients: [{ Id: "original-reliability", Hash: token_hash(Token) }] }, Factory);
	let Client: RemoteConnection | null = null;
	try
	{
		const Url = "http://127.0.0.1:" + await Bridge.listen();
		const Http = async (Path: string, Method: string, Body?: unknown) => { assert.equal(Method, "GET", "Recovery accepts only read-only HTTP queries"); assert.equal(Body, undefined); const R = await fetch(Url + Path, { headers: { Authorization: "Bearer " + Token }, signal: AbortSignal.timeout(30000) }); const Data: any = await R.json(); if(!R.ok) { throw new Error(Data.error); } return Data; };
		Client = new RemoteConnection(Http, { Enabled: true, Url, Token, Cursor: 0, Server: "" }, () => {}, () => {}, () => {}); await Client.connect();
		assert.equal(Client.Info.bridgeVersion, ProductVersion); assert.equal(Client.Info.protocolVersion, 2); assert.equal(Client.scope(), Local.Sync.Scope);
		const Operation = await Client.operation_status(Ledger.operationId); assert.equal(Operation?.Status, "completed"); assert.ok(Operation?.TurnId);
		const Restored = await Client.restore_state(Local), Session = Restored.Sessions.find((S: any) => S.Id === Operation!.SessionId)!, OriginalSession = Local.Sessions.find((S: any) => S.Id === Session.Id);
		const Current = Session.Messages.find((M: any) => M.Id === Operation!.MessageId)!, Previous = OriginalSession.Messages.find((M: any) => M.Id === Current.Id), Proof = Session.Messages.find((M: any) => M.Id === "original-proof")!;
		assert.deepEqual(Current.Context, Previous.Context); assert.equal(Current.Prompt, Previous.Prompt); assert.equal(Proof.Text, OriginalSession.Messages.find((M: any) => M.Id === Proof.Id).Text);
		assert.deepEqual((Operation!.Input as any).Context, Previous.Context); assert.equal((Operation!.Input as any).Prompt, Previous.Prompt);
		const Answer = Session.Messages.find((M: any) => M.Role === "assistant" && M.Phase !== "commentary" && M.TurnId === Operation!.TurnId); assert.ok(Answer?.Text);
		const RecoveryPages = (Failure.historyReplies ?? []).filter((R: any) => R.success).flatMap((R: any) => R.contentItems ?? []).flatMap((I: any) => { try { const P = JSON.parse(I.text); return P.message_id === Proof.Id ? [P] : []; } catch { return []; } });
		const ReadOriginal = RecoveryPages.some((P: any) => P.offset === 0 && P.text === Proof.Text.slice(0, 12000)) && RecoveryPages.some((P: any) => P.offset === 12000 && P.text === Proof.Text.slice(12000));
		const Request = Operation!.Request as any; assert.ok(ServerSkill); assert.equal(Request.model, "gpt-6.1-sol"); assert.equal(Request.effort, "low"); assert.equal(Request.serviceTier, "default");
		const Expected = { threadId: Request.threadId, input: skill_input(Request.input[0].text, ServerSkill!), model: Request.model, effort: Request.effort, serviceTier: Request.serviceTier, summary: "auto" };
		const HostSkillVerified = Operation!.HostRequestDigest === await content_digest(Expected); assert.equal(HostSkillVerified, true);
		const Report = { status: "completed-with-probe-correction", layer: "same single real inference; read-only protocol-2 recovery on an independently recreated TEMP bridge, not iPad", originalProbeAssertionFailure: Failure.error, correction: "protocol 2 emits bridge/message-updated; old probe only observed item/completed", productVersion: Client.Info.bridgeVersion, protocol: Client.Info.protocolVersion, cliVersion: Runtime.Version, skillVersion: Ledger.skillVersion, recoveredSkillVersion: Client.Info.mathWritingVersion, originalInferenceSubmissions: Ledger.inferenceSubmissions, newInferenceSubmissions: NewSubmissions, operationStatus: Operation!.Status, stableDataIdentity: Client.scope() === Local.Sync.Scope, originalPromptPreserved: true, originalSnapshotPreserved: true, originalProofPreserved: true, originalPromptDigest: await content_digest(Previous.Prompt), originalSnapshotVersion: Previous.Context.Version, originalProofDigest: await content_digest(Proof.Text), historyReadCalls: Failure.historyCalls, historyReadSucceeded: !!ReadOriginal, proofWasOmittedFromInjectedHistory: Previous.InputLedger.DeferredMaterials?.some((M: any) => M.MessageId === Proof.Id), verificationWordReturned: Answer.Text.includes("AMBER-INTEGRAL-29"), hostRequestDigestVerifiesServerSelectedSkill: HostSkillVerified, output: Answer.Text, threadEvidence: "Original live run passed ephemeral=true/path=null checks before submission. Production bridge fixes sandbox=read-only and approvalPolicy=never; recovery does not create or restart an inference thread." };
		writeFileSync(join(Directory, "recovery-report.json"), JSON.stringify(Report, null, 2)); writeFileSync(join(Directory, "client-recovered.json"), JSON.stringify(Restored, null, 2));
		process.stdout.write(JSON.stringify({ ...Report, output: undefined, historyReadCalls: Failure.historyCalls?.length }) + "\n");
	}
	finally { Closing = true; Client?.close(); await Bridge.close(); }
}

async function run_live(): Promise<void>
{
	if(process.env.CODEX_ROUND2_LIVE !== "1" || !process.env.CODEX_ROUND2_EVIDENCE) { throw new Error("Explicit opt-in requires CODEX_ROUND2_LIVE=1 and a new CODEX_ROUND2_EVIDENCE directory under TEMP"); }
	const Directory = resolve(process.env.CODEX_ROUND2_EVIDENCE), InsideTemp = relative(resolve(tmpdir()), Directory);
	if(!isAbsolute(process.env.CODEX_ROUND2_EVIDENCE) || !InsideTemp || InsideTemp.startsWith("..") || isAbsolute(InsideTemp)) { throw new Error("Evidence must be a separate owned directory inside TEMP"); }
	mkdirSync(Directory, { recursive: true });
	const LedgerPath = join(Directory, "request-ledger.json"), ReportPath = join(Directory, "report.json");
	if(existsSync(LedgerPath)) { if(process.env.CODEX_ROUND2_RECOVER === "1") { return recover_live(Directory, JSON.parse(readFileSync(LedgerPath, "utf8"))); } throw new Error("A run ledger already exists. Inspect it; this script never automatically repeats an inference"); }
	const Ledger: any = { status: "preflight", inferenceLimit: 1, attempted: false, startedAt: new Date().toISOString(), layer: "real loopback HTTP protocol 2 + actual CLI; no iPad/Tailscale/daily-plugin acceptance" };
	const SaveLedger = () => writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2));
	writeFileSync(LedgerPath, JSON.stringify(Ledger, null, 2), { flag: "wx", mode: 0o600 });
	const Cwd = join(Directory, "original-workspace"), StateDir = join(Directory, "isolated-bridge-state"); mkdirSync(Cwd);
	writeFileSync(join(Cwd, "AGENTS.md"), "# Original isolated acceptance\nRead only. Use only supplied original mathematics and the bound conversation history tool. Do not read any other notes, authentication, configuration or personal files. Never run shell/eval or write files.\n");
	const Discovered = process.env.CODEX_ROUND2_CLI || await discover_cli(), Cli = resolve_codex_executable(Discovered), Runtime = await runtime_info(Cli);
	assert.equal(Runtime.Complete, true, "A complete CLI runtime with companion programs is required");
	const Token = randomBytes(32).toString("hex"), ClientId = "original-reliability", SessionId = randomUUID();
	let Bridge: RemoteBridge | null = null, Client: RemoteConnection | null = null, Closing = false, TurnStarts = 0, Output = "", ReasoningUpdates = 0;
	const Calls: { Method: string; Detail?: any }[] = [], HistoryCalls: any[] = [], HistoryReplies: any[] = [], ReadEvents: any[] = [], HistoryIds = new Set<string | number>();
	const Opening = "# Original long proof\n\n设 f 是闭区间 [0,1] 上的连续实函数, M=max|f|. 沿原路线: -M<=f(t)<=M, 积分保持序, 再取绝对值. 核验词: AMBER-INTEGRAL-29.\n\n", Tail = "\n\n---\n\n$$\n\\left|\\int_0^1 f(t)\\,dt\\right|\\leq\\lVert f\\rVert_\\infty.\n$$\n\n以上沿同一估计路线成立.";
	const OriginalProof = Opening + "条件是实值函数在闭区间连续, 因而绝对值取得最大值; 原证明使用积分的单调性.\n\n".repeat(600).slice(0, 22400 - Opening.length - Tail.length) + Tail;
	const Factory = (Path: string, Root: string, Notify: (M: any) => void, Closed: (E: Error) => void): RpcConnection =>
	{
		const Connection = new CodexConnection(Path, Root, M =>
		{
			if(M.id !== undefined && M.method === "item/tool/call" && M.params?.tool === "obsidian_history_read") { HistoryIds.add(M.id); HistoryCalls.push(structuredClone(M.params.arguments)); ReadEvents.push({ arguments: structuredClone(M.params.arguments), reasoningUpdates: ReasoningUpdates }); }
			if(M.method?.includes("reasoning") && M.method?.includes("Delta")) { ReasoningUpdates++; } Notify(M);
		}, E => { if(!Closing) { Closed(E); } });
		return {
			request: async (Method, Params) =>
			{
				if(Method === "turn/start") { if(TurnStarts >= 1) { throw new Error("Inference limit reached, no second turn/start permitted"); } TurnStarts++; Ledger.inferenceSubmissions = TurnStarts; SaveLedger(); Calls.push({ Method, Detail: { model: Params.model, effort: Params.effort, inputs: Params.input.map((I: any) => ({ type: I.type, name: I.name })), serverSkillSelected: Params.input[1]?.path !== "/bridge/math-writing/SKILL.md" } }); }
				else if(Method === "thread/start") { Calls.push({ Method, Detail: { ephemeral: Params.ephemeral, sandbox: Params.sandbox, approvalPolicy: Params.approvalPolicy, dynamicTools: Params.dynamicTools.map((T: any) => T.name) } }); }
				else { Calls.push({ Method }); }
				return Connection.request(Method, Params);
			},
			send: M => { if(M.id !== undefined && HistoryIds.has(M.id)) { HistoryReplies.push(structuredClone(M.result)); } Connection.send(M); },
			close: () => Connection.close()
		};
	};
	const Config: BridgeConfig = { Port: 0, Cli, Cwd, Vault: "original-reliability-fixture", ObsidianCli: "not-used-original-fixture", StateDir, Clients: [{ Id: ClientId, Hash: token_hash(Token) }] };
	const Remote: RemoteConfig = { Enabled: true, Url: "", Token, Cursor: 0, Server: "", CacheId: "original-fixture" };
	let ResolveTurn!: (T: any) => void, RejectTurn!: (E: Error) => void;
	const Done = new Promise<any>((Accept, Reject) => { ResolveTurn = Accept; RejectTurn = Reject; }); void Done.catch(() => {});
	const Http = async (Path: string, Method: string, Body?: unknown): Promise<any> =>
	{
		const Response = await fetch(Remote.Url + Path, { method: Method, headers: { Authorization: "Bearer " + Token, "Content-Type": "application/json" }, ...(Body === undefined ? {} : { body: JSON.stringify(Body) }), signal: AbortSignal.timeout(45000) });
		const Data: any = await Response.json(); if(!Response.ok) { throw new Error(Data.error ?? "Original bridge request failed"); } return Data;
	};
	const Connect = async () =>
	{
		Client = new RemoteConnection(Http, Remote, M =>
		{
			const Text = live_answer_text(M); if(Text !== null) { Output = Text; }
			if(M.method === "turn/completed") { ResolveTurn(M.params.turn); }
		}, E => { if(!Closing) { RejectTurn(E); } }, () => {});
		await Client.connect(); return Client;
	};
	const Files = { exists: async (P: string) => existsSync(P), read: async (P: string) => readFileSync(P, "utf8"), write: async (P: string, T: string) => { writeFileSync(P, T); } };
	let OperationId = "", Timer: ReturnType<typeof setTimeout> | undefined;
	try
	{
		Bridge = new RemoteBridge(Config, Factory); Remote.Url = "http://127.0.0.1:" + await Bridge.listen();
		let Connection = await Connect(); const Info = Connection.Info;
		assert.equal(Info.bridgeVersion, ProductVersion); assert.equal(Info.protocolVersion, 2); assert.equal(Info.capabilities.historyRead, 1); assert.equal(Info.capabilities.operationStatus, 1);
		const Catalog = await Connection.request("model/list", { limit: 100, includeHidden: false }), Model = Catalog.data.find((M: any) => M.model === "gpt-6.1-sol");
		if(!Model?.supportedReasoningEfforts?.some((E: any) => E.reasoningEffort === "low")) { throw new Error("Requested gpt-6.1-sol/low is unavailable; no alternative model or inference was selected"); }
		const Instructions = client_instructions(DefaultInstructions, null) + "\n本轮是原创隔离验收. 只用用户材料和当前授权会话的 obsidian_history_read, 不运行 shell、不读其他文件. 用户明确要求读取旧证明时先实际调用该工具; 不猜缺失的核验词.";
		const Thread = await Connection.request("thread/start", { clientSessionId: SessionId, model: Model.model, developerInstructions: Instructions, serviceTier: "default", config: { model_reasoning_effort: "low" } });
		assert.equal(Thread.thread.ephemeral, true); assert.equal(Thread.thread.path, null);
		const Source = "# Original analysis\n\n设 $f(t)=t$, $0\\le t\\le1$. 请核验 $\\left|\\int_0^1 f(t)\\,dt\\right|\\le\\max_{[0,1]}|f|$.\n";
		writeFileSync(join(Cwd, "Original-analysis.md"), Source);
		const Context: ContextSnapshot = { Path: "Original-analysis.md", Text: Source, SelectedText: "", Heading: "Original analysis", Mode: "阅读", Kind: "当前位置", Mapping: "源块", CapturedAt: new Date().toISOString(), LineStart: 0, LineEnd: 2, Truncated: false, Version: await version_of(Source) };
		const Question = "这次只作简短局部解释, 不重述整篇. 请实际补读 original-proof 的完整原文后解释尾部估计: 首先调用 obsidian_history_read read message_id=original-proof field=text offset=0 length=12000 source_version=" + text_identity(OriginalProof) + ", 再使用第一页返回的 version 读取 offset=12000 length=12000 (继续保留 source_version). 不跳过第二页. 说明实值、闭区间连续条件和 f(t)=t 的验算, 最后给出原文中的核验词; 若读取失败应如实说, 不猜补.";
		const Quote = answer_quote(SessionId, "original-proof", "积分的绝对值为何不超过最大值", OriginalProof, "completed");
		// An explicitly narrowed original quote, preserving its full-message version.
		Quote.SourceText = Tail; Quote.SourceRange = { From: OriginalProof.length - Tail.length, To: OriginalProof.length, Total: OriginalProof.length }; Quote.SourceTruncated = true; Quote.SourceBlocks = []; Quote.Mapping = "source-blocks";
		const Prompt = build_prompt(Question, Context, Quote);
		const History: ChatMessage[] = [{ Id: "proof-question", Role: "user", TurnId: "old-proof-turn", Text: "给出连续函数积分的最大值估计.", Prompt: "原创历史问题, 本轮由工具补读." }, { Id: "original-proof", Role: "assistant", TurnId: "old-proof-turn", Text: OriginalProof, CompletionStatus: "completed" }, { Id: "recent-question", Role: "user", TurnId: "recent-turn", Text: "请保留连续性与定义域条件.", Prompt: "请保留连续性与定义域条件." }, { Id: "recent-answer", Role: "assistant", TurnId: "recent-turn", Text: "已记录. 需要旧证明时应实际补读, 不猜它的结论或核验词.", CompletionStatus: "completed" }];
		const CurrentDraft: ChatMessage = { Id: "current-question", Role: "user", Text: Question, Prompt, Context, Quote };
		const Plan = build_history_input(History, { MaxUtf8Bytes: 36000, ModelContextWindow: 400000, RequiredMessageIds: ["original-proof"], CurrentMessage: CurrentDraft, SessionId, ReservedUtf8Bytes: new TextEncoder().encode(Instructions).length, HistoryReadAvailable: true, HistoryReadBodyVersionsAvailable: true }); assert.ok(Plan.Ledger.DeferredMaterials?.some(M => M.MessageId === "original-proof")); assert.ok(!JSON.stringify(Plan.Items).includes("AMBER-INTEGRAL-29"));
		await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: [...instruction_items(Instructions), ...Plan.Items] });
		const Message: ChatMessage = { Id: "current-question", Role: "user", Text: Question, Prompt, Context: structuredClone(Context), Quote: structuredClone(Quote), InputLedger: Plan.Ledger };
		const Operation = await create_send_operation(Connection.scope(), SessionId, Message.Id, { Prompt, Context: structuredClone(Context), Quote: structuredClone(Quote), Run: { Model: Model.model, Effort: "low", Fast: false } }); OperationId = Operation.Id; Message.OperationId = Operation.Id;
		let State: any = { Settings: { Model: Model.model, Effort: "low", Fast: false }, Sessions: [{ Id: SessionId, Title: "Original analysis", ThreadId: Thread.thread.id, Private: true, Messages: [...History, Message] }], ActiveId: SessionId };
		State = await Connection.restore_state(State); State.Sync.Operations.push(Operation);
		await Connection.sync_state(State); await write_state_file(Files, join(Directory, "client-state-v2.json"), State);
		const Skill = (await Connection.request("skills/list", {})).data[0].skills.find((S: any) => S.name === "math-writing" && S.enabled); assert.ok(Skill);
		Ledger.operationId = Operation.Id; Ledger.operationDigest = Operation.Digest; Ledger.status = "ready"; Ledger.cliVersion = Runtime.Version; Ledger.skillVersion = Info.mathWritingVersion; SaveLedger();
		Connection.start(); Timer = setTimeout(() => RejectTurn(new Error("Real inference timed out; inspect the persistent operation, no retry")), 150000);
		await Connection.request_operation(Operation, { threadId: Thread.thread.id, input: skill_input(derived_message_prompt(Message), { type: "skill", name: "math-writing", path: Skill.path }), model: Model.model, effort: "low", serviceTier: "default" }, async () => { Ledger.attempted = true; Ledger.status = "submission-unknown"; SaveLedger(); });
		const Turn = await Done; clearTimeout(Timer); assert.equal(Turn.status, "completed"); assert.ok(Output); assert.equal(TurnStarts, 1);
		const Terminal = await Connection.operation_status(Operation.Id); assert.equal(Terminal?.Status, "completed"); assert.equal(Terminal?.TurnId, Turn.id);
		State = await Connection.restore_state(State); assert.deepEqual(State.Sessions.find((S: any) => S.Id === SessionId).Messages.find((M: any) => M.Id === Message.Id).Context, Context);
		await write_state_file(Files, join(Directory, "client-state-v2.json"), State);
		Closing = true; Connection.close(); await Bridge.close(); Bridge = new RemoteBridge(Config, Factory); Remote.Url = "http://127.0.0.1:" + await Bridge.listen(); Closing = false;
		Connection = await Connect(); assert.notEqual(Connection.Info.server, Info.server); assert.equal(Connection.Info.dataIdentity, Info.dataIdentity);
		const Restored = await Connection.restore_state(State), RestoredOperation = await Connection.operation_status(Operation.Id);
		assert.equal(RestoredOperation?.Status, "completed"); assert.equal(RestoredOperation?.TurnId, Turn.id); assert.equal(TurnStarts, 1);
		const RestoredSession = Restored.Sessions.find((S: any) => S.Id === SessionId)!;
		assert.deepEqual(RestoredSession.Messages.find((M: any) => M.Id === Message.Id).Context, Context); assert.equal(RestoredSession.Messages.find((M: any) => M.Id === "original-proof").Text, OriginalProof);
		assert.ok(RestoredSession.Messages.some((M: any) => M.Role === "assistant" && M.Text === Output));
		const Start = Calls.find(C => C.Method === "thread/start")!.Detail, Sent = Calls.find(C => C.Method === "turn/start")!.Detail;
		assert.equal(Start.ephemeral, true); assert.equal(Start.sandbox, "read-only"); assert.equal(Start.approvalPolicy, "never"); assert.ok(Start.dynamicTools.includes("obsidian_history_read"));
		assert.equal(Sent.inputs.length, 2); assert.equal(Sent.inputs[1].name, "math-writing"); assert.equal(Sent.serverSkillSelected, true);
		const ReadOriginal = HistoryReplies.some(R => R.success && R.contentItems?.some((I: any) => { try { const Page = JSON.parse(I.text); return Page.message_id === "original-proof" && Page.offset === 0 && Page.text === OriginalProof.slice(0, 12000); } catch { return false; } }));
		const ReadPages = HistoryReplies.filter(R => R.success).flatMap(R => R.contentItems.map((I: any) => { try { return JSON.parse(I.text); } catch { return null; } })).filter((P: any) => P?.message_id === "original-proof"); assert.ok(ReadPages.some((P: any) => P.offset === 12000 && P.text === OriginalProof.slice(12000))); assert.equal(new Set(ReadPages.map((P: any) => P.version)).size, 1); assert.equal(RestoredSession.Messages.find((M: any) => M.Id === Message.Id).Prompt, Prompt); assert.deepEqual(RestoredSession.Messages.find((M: any) => M.Id === Message.Id).Quote, Quote);
		const Report = { status: "completed", originalChars: OriginalProof.length, actualPageOffsets: ReadPages.map((P: any) => P.offset), readEvents: ReadEvents, reasoningUpdates: ReasoningUpdates, unrelatedReasoningBetweenPages: ReadEvents.length > 1 && ReadEvents.at(-1).reasoningUpdates > ReadEvents[0].reasoningUpdates, stableBodyVersion: true, originalPromptQuoteContextPreserved: true, inputLedger: Plan.Ledger, layer: Ledger.layer, productVersion: Info.bridgeVersion, protocol: Info.protocolVersion, model: Model.model, effort: "low", cliVersion: Runtime.Version, completeRuntime: Runtime.Complete, skillVersion: Info.mathWritingVersion, inferenceSubmissions: TurnStarts, deferredProofInLedger: true, actualHistoryToolCalls: HistoryCalls, actualHistoryReadSucceeded: ReadOriginal, verificationWordReturned: Output.includes("AMBER-INTEGRAL-29"), sandbox: Start.sandbox, approvalPolicy: Start.approvalPolicy, ephemeral: Start.ephemeral, inputs: Sent.inputs, serverSelectedSkill: Sent.serverSkillSelected, stableDataIdentityAcrossOwnedBridgeRestart: true, operationAndAnswerRecovered: true, originalSnapshotPreserved: true, clientCheckpoint: true, output: Output };
		writeFileSync(ReportPath, JSON.stringify(Report, null, 2)); Object.assign(Ledger, { status: "completed", finishedAt: new Date().toISOString(), actualHistoryReadSucceeded: ReadOriginal }); SaveLedger();
		process.stdout.write(JSON.stringify({ ...Report, actualHistoryToolCalls: HistoryCalls.length, output: undefined }) + "\n");
	}
	catch(ErrorValue)
	{
		const CurrentClient = Client as RemoteConnection | null;
		let Status: unknown = null; if(Ledger.attempted && CurrentClient && OperationId) { try { Status = await CurrentClient.operation_status(OperationId); } catch { /* Read-only status query failed; never submit again. */ } }
		Object.assign(Ledger, { status: Ledger.attempted ? "requires-inspection" : "preflight-failed", error: String(ErrorValue), operationStatus: Status, inferenceSubmissions: TurnStarts }); SaveLedger();
		writeFileSync(ReportPath, JSON.stringify({ ...Ledger, output: Output, historyCalls: HistoryCalls, historyReplies: HistoryReplies, transportCalls: Calls }, null, 2)); throw ErrorValue;
	}
	finally { clearTimeout(Timer); Closing = true; (Client as RemoteConnection | null)?.close(); await Bridge?.close(); }
}

if(/(?:^|[\\/])reliability-round2-live\.(?:ts|js|cjs)$/.test(process.argv[1] ?? "")) { void run_live().catch(E => { process.stderr.write(String(E) + "\n"); process.exitCode = 1; }); }
