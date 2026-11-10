import assert from "node:assert/strict";
import { test } from "node:test";
import { BackendConnection, backend_generate, type BackendInput } from "../src/backend";
import type { BackendResult } from "../src/backend-result";
import { parse_api_result } from "../src/api-result";
import { backend_capabilities, api_protocol } from "../src/backend-capabilities";
import { backend_profile, type BackendProfile } from "../src/backend-profile";
import { direct_api, ApiHistoryBudget } from "../src/direct-api";

const Key = "original-fixture-secret";
const Input: BackendInput = { Session: "original-session", Messages: [{ Role: "user", Text: "Prove the finite sum identity." }] };
function profile(Extra: object = {}): Extract<BackendProfile, { Kind: "api" }>
{
	const P = backend_profile({ Kind: "api", Provider: "openai", Model: "fixture", Stream: "buffered", ...Extra });
	if(P.Kind !== "api") { throw Error("fixture"); } return P;
}
const chat = (Text: string | null, Reason = "stop", Extra: object = {}) => ({ id: "chat-original", model: "actual-model", choices: [{ finish_reason: Reason, message: { content: Text } }], ...Extra });
const response = (Text: string, Status = "completed", Extra: object = {}) => ({ id: "response-original", model: "actual-model", status: Status, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: Text }] }], ...Extra });

test("native buffered diagnostics retain the HTTP result when the response cannot be parsed as JSON", async () =>
{
	let Posts = 0;
	for(const Status of [403, 200])
	{
		const Run = direct_api(profile({ Provider: "opencode" }), Key, async () =>
		{
			Posts++;
			return { status: Status, get json(): never { throw new Error("not-json and do not expose the raw response"); } };
		});
		const Result = await Run(Input, new AbortController().signal);
		assert.equal(Result.Status, Status === 403 ? "failed" : "unknown");
		assert.equal(Result.Metadata.Transport, "buffered");
		assert.match(Result.Metadata.Reason!, new RegExp(`HTTP ${Status}`));
		assert.doesNotMatch(Result.Metadata.Reason!, /raw response/);
	}
	assert.equal(Posts, 2);
});

for(const Case of [
	{ Protocol: "chat", Value: chat("proof", "length"), Status: "partial", Text: "proof", Reason: "length" },
	{ Protocol: "chat", Value: chat("safe text", "content_filter"), Status: "refused", Text: "safe text", Reason: "content_filter" },
	{ Protocol: "chat", Value: chat(null, "stop", { choices: [{ finish_reason: "stop", message: { refusal: "cannot answer" } }] }), Status: "refused", Text: "cannot answer", Reason: "stop" },
	{ Protocol: "chat", Value: chat("", "stop"), Status: "failed", Text: "", Reason: "empty-body" },
	{ Protocol: "chat", Value: chat("received", "future-status"), Status: "unknown", Text: "received", Reason: "future-status" },
	{ Protocol: "responses", Value: response("proof", "incomplete", { incomplete_details: { reason: "max_output_tokens" } }), Status: "partial", Text: "proof", Reason: "max_output_tokens" },
	{ Protocol: "responses", Value: response("proof", "failed", { error: { code: "server-error" } }), Status: "partial", Text: "proof", Reason: "server-error" },
	{ Protocol: "responses", Value: response("", "completed"), Status: "failed", Text: "", Reason: "empty-body" },
	{ Protocol: "responses", Value: response("received", "in_progress"), Status: "unknown", Text: "received", Reason: "in_progress" }
] as const)
{
	test(`preserves ${Case.Protocol} ${Case.Reason} content and terminal meaning`, () =>
	{
		const { Result } = parse_api_result(Case.Value, Case.Protocol, "request-original");
		assert.equal(Result.Status, Case.Status); assert.equal(Result.Text, Case.Text); assert.equal(Result.Metadata.Reason, Case.Reason);
		assert.equal(Result.Metadata.Model, "actual-model"); assert.deepEqual(Result.Metadata.Receipts, [{ RequestId: "request-original", ResponseId: Case.Value.id }]);
		assert.equal(Result.Metadata.Usage, undefined);
	});
}

test("actual usage retains zero values and containment without inventing absent totals", () =>
{
	const Raw = { input_tokens: 11, output_tokens: 7, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 4 } };
	const Usage = parse_api_result(response("proof", "completed", { usage: Raw }), "responses").Result.Metadata.Usage![0];
	assert.equal(Usage.Kind, "cumulative"); assert.equal(Usage.InputTokens, 11); assert.equal(Usage.OutputTokens, 7);
	assert.equal(Usage.TotalTokens, undefined); assert.equal(Usage.CachedInputTokens, 0); assert.equal(Usage.ReasoningOutputTokens, 4); assert.deepEqual(Usage.Raw, Raw);
});

test("explicit protocol wins; responses catalog format is independent of default/high/default effort", async () =>
{
	assert.equal(api_protocol(profile({ Protocol: "chat" }), { Format: "responses", Efforts: ["high"] }), "chat");
	const Requests: any[] = [];
	const Driver = direct_api(profile({ Provider: "opencode" }), Key, async R => { Requests.push(R); return { status: 200, json: response("proof") }; }, { Format: "responses", Efforts: ["high"] });
	for(const Effort of [undefined, "high", undefined]) { assert.equal((await Driver({ ...Input, Effort }, new AbortController().signal)).Status, "completed"); }
	assert.ok(Requests.every(R => R.url.endsWith("/responses")));
	assert.deepEqual(Requests.map(R => JSON.parse(R.body).reasoning), [undefined, { effort: "high" }, undefined]);
	assert.ok(Requests.every(R => JSON.parse(R.body).store === false));
});

test("fixed history tool follows host version failures and never exposes a shell", async () =>
{
	const Requests: any[] = [], Reads: unknown[] = [];
	const Tool = { id: "call-1", type: "function", function: { name: "obsidian_history_read", arguments: JSON.stringify({ command: "read", message_id: "saved", version: "stale" }) } };
	const Driver = direct_api(profile({ Provider: "deepseek" }), Key, async R =>
	{
		const Body = JSON.parse(R.body!); Requests.push(Body);
		assert.deepEqual(Body.tools.map((T: any) => T.function.name), ["obsidian_history_read"]);
		if(Requests.length === 1) { return { status: 200, json: chat(null, "tool_calls", { choices: [{ finish_reason: "tool_calls", message: { content: null, reasoning_content: "provider-thinking", tool_calls: [Tool] } }] }) }; }
		assert.equal(Body.messages.at(-2).reasoning_content, "provider-thinking");
		assert.match(Body.messages.at(-1).content, /version mismatch/);
		return { status: 200, json: chat("Source version differs; select the saved original.") };
	});
	const Result = await Driver({ ...Input, HistoryRead: async A => { Reads.push(A); return { success: false, contentItems: [{ type: "inputText", text: "version mismatch" }] }; } }, new AbortController().signal);
	assert.equal(Result.Status, "completed"); assert.equal(Reads.length, 1); assert.equal(Requests.length, 2);
	assert.equal(Reflect.get(Reads[0] as object, "version"), "stale");
});

test("Responses history round carries original function output without enabling storage", async () =>
{
	let Calls = 0;
	const Driver = direct_api(profile(), Key, async R =>
	{
		const B = JSON.parse(R.body!); assert.equal(B.store, false); assert.equal(B.tools[0].name, "obsidian_history_read");
		if(++Calls === 1) { return { status: 200, json: response("", "completed", { output: [{ type: "function_call", call_id: "history-1", name: "obsidian_history_read", arguments: '{"command":"list"}' }], usage: { input_tokens: 10 } }) }; }
		assert.equal(B.input.at(-1).type, "function_call_output"); assert.equal(B.input.at(-1).call_id, "history-1");
		return { status: 200, json: response("proof", "completed", { usage: { output_tokens: 9 } }) };
	});
	const Result = await Driver({ ...Input, HistoryRead: async () => ({ success: true, contentItems: [{ type: "inputText", text: "saved original" }] }) }, new AbortController().signal);
	assert.equal(Calls, 2); assert.equal(Result.Status, "completed"); assert.equal(Result.Metadata.Usage?.length, 2);
	assert.equal(Result.Metadata.Usage![0].OutputTokens, undefined);
});

test("compatible history tools require explicit enablement, forbidden tools never call the host", async () =>
{
	for(const HistoryTools of [undefined, false, true])
	{
		let Reads = 0, Requests = 0;
		const Driver = direct_api(profile({ Provider: "compatible", Base: "https://fixture.example/v1", HistoryTools }), Key, async R =>
		{
			Requests++; const B = JSON.parse(R.body!); assert.equal(!!B.tools, HistoryTools === true);
			return { status: 200, json: chat(null, "tool_calls", { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "bad", type: "function", function: { name: "shell", arguments: "{}" } }] } }] }) };
		});
		const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; throw Error("must not execute"); } }, new AbortController().signal);
		assert.equal(Result.Status, "partial"); assert.equal(Reads, 0); assert.equal(Requests, 1);
		assert.equal(backend_capabilities(profile({ Provider: "compatible", Base: "https://fixture.example/v1", HistoryTools }), { HistoryRead: true }).HistoryRead, HistoryTools === true ? true : HistoryTools === false ? false : "unknown");
	}
});

test("tool round/call/output budgets stop additional POSTs; ambiguous continuation is never retried", async () =>
{
	for(const Mode of ["rounds", "calls", "bytes", "network"])
	{
		let Requests = 0, Reads = 0;
		const Driver = direct_api(profile({ Provider: "deepseek" }), Key, async () =>
		{
			Requests++;
			if(Mode === "network" && Requests > 1) { throw Error("socket lost after POST"); }
			return { status: 200, json: chat("intermediate", "tool_calls", { choices: [{ finish_reason: "tool_calls", message: { content: "intermediate", tool_calls: Array.from({ length: Mode === "calls" ? 7 : 1 }, (_, I) => ({ id: `c-${Requests}-${I}`, type: "function", function: { name: "obsidian_history_read", arguments: '{"command":"list"}' } })) } }] }) };
		});
		const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return { success: true, contentItems: [{ type: "inputText", text: Mode === "bytes" ? "数".repeat(11000) : "saved" }] }; } }, new AbortController().signal);
		assert.equal(Result.Status, Mode === "network" ? "unknown" : "partial"); assert.match(Result.Text, /intermediate/);
		assert.ok(Reads <= ApiHistoryBudget.MaxCalls); assert.ok(Requests <= ApiHistoryBudget.MaxRounds + 1);
		if(Mode === "bytes" || Mode === "calls") { assert.equal(Requests, 1); }
		if(Mode === "network") { assert.equal(Requests, 2); }
	}
});

test("stopping buffered wait releases immediately and archives actual late body/usage with original identity", async () =>
{
	let Release!: (V: any) => void;
	const Events: any[] = [];
	const Driver = direct_api(profile(), Key, () => new Promise(Resolve => { Release = Resolve; }));
	const C = new BackendConnection(profile(), Driver, E => Events.push(E));
	const { thread } = await C.request("thread/start", { clientSessionId: Input.Session });
	const { turn } = await C.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "original" }] });
	C.begin_turn(turn.id); await Promise.resolve();
	await C.request("turn/interrupt", { threadId: thread.id, turnId: turn.id });
	await new Promise(R => setImmediate(R)); C.close();
	assert.equal(Events.filter(E => E.method === "backend/result-unknown").length, 1);
	Release({ status: 200, json: response("late proof", "completed", { usage: { output_tokens: 7 } }) });
	await new Promise(R => setImmediate(R));
	const Late = Events.find(E => E.method === "backend/result" && E.params.late);
	assert.equal(Late.params.result.Text, "late proof"); assert.equal(Late.params.result.Metadata.Usage[0].OutputTokens, 7);
	assert.equal(Late.params.turnId, turn.id); assert.equal(Late.params.sessionId, Input.Session);
	assert.equal(Events.filter(E => E.method === "turn/completed").length, 0);
	assert.equal(new Set(Events.filter(E => E.params.itemId).map(E => E.params.itemId)).size, 1);
});

test("pre-submit cancellation never invokes driver and completed result is not downgraded by late abort", async () =>
{
	let Requests = 0; const Events: any[] = [];
	const C = new BackendConnection(profile(), async () => { Requests++; return "done"; }, E => Events.push(E));
	const { thread } = await C.request("thread/start", { clientSessionId: "before-submit" });
	const { turn } = await C.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "original" }] });
	await C.request("turn/interrupt", { threadId: thread.id, turnId: turn.id }); C.begin_turn(turn.id);
	await new Promise(R => setImmediate(R));
	assert.equal(Requests, 0); assert.equal(Events.find(E => E.method === "backend/result").params.result.Metadata.Submission, "not-submitted");
	const Abort = new AbortController();
	const Result = await backend_generate(async () => ({ Text: "proof", Status: "completed", Metadata: { Submission: "submitted" } }), Input, Abort.signal);
	Abort.abort(); assert.equal(Result.Status, "completed"); C.close();
});

test("buffered deadline preserves a later actual receipt without another submission", async () =>
{
	let Release!: (V: any) => void, Requests = 0; const Late: BackendResult[] = [];
	const D = direct_api(profile(), Key, () => { Requests++; return new Promise(R => { Release = R; }); }, undefined, { Budget: { TotalMs: 30 } });
	const Result = await D({ ...Input, OnLateResult: R => Late.push(R) }, new AbortController().signal);
	assert.equal(Result.Status, "unknown");
	Release({ status: 200, headers: { "x-request-id": "late-original" }, json: response("actual proof") });
	await new Promise(R => setImmediate(R));
	assert.equal(Requests, 1); assert.equal(Late.length, 1); assert.equal(Late[0].Status, "completed");
	assert.equal(Late[0].Metadata.Receipts?.[0].RequestId, "late-original");
});

test("abort between begin and first driver instruction is still confirmed not submitted", async () =>
{
	const Abort = new AbortController(); let Requests = 0;
	const Pending = backend_generate(async () => { Requests++; return "must not run"; }, Input, Abort.signal);
	Abort.abort(); const Result = await Pending;
	assert.equal(Requests, 0); assert.equal(Result.Status, "cancelled"); assert.equal(Result.Metadata.Submission, "not-submitted"); assert.equal(Result.Metadata.Wait, "stopped");
});
