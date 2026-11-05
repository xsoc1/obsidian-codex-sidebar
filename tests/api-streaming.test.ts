import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { SseDecoder } from "../src/api-sse";
import { direct_api } from "../src/direct-api";
import type { BackendInput } from "../src/backend";
import { BackendConnection } from "../src/backend";
import { backend_profile, type BackendProfile } from "../src/backend-profile";

const Key = "stream-fixture-secret";
const Encoder = new TextEncoder();
const Input: BackendInput = { Session: "stream-original", Messages: [{ Role: "user", Text: "Prove a finite identity." }] };
function profile(Extra: object = {}): Extract<BackendProfile, { Kind: "api" }>
{
	const P = backend_profile({ Kind: "api", Provider: "deepseek", Model: "fixture", Stream: "auto", ...Extra });
	if(P.Kind !== "api") { throw Error("fixture"); } return P;
}
const frame = (V: unknown, Extra = "") => Extra + "data: " + (typeof V === "string" ? V : JSON.stringify(V)) + "\n\n";
const chat = (Content: string, Finish: string | null = null, Extra: object = {}) => ({ id: "chat-receipt", model: "effective-model", choices: [{ index: 0, delta: { content: Content }, finish_reason: Finish }], ...Extra });
function fixture_fetch(Chunks: (string | Uint8Array)[]): typeof fetch
{
	return async () => new Response(new ReadableStream({ start(C)
	{
		for(const Chunk of Chunks) { C.enqueue(typeof Chunk === "string" ? Encoder.encode(Chunk) : Chunk); } C.close();
	} }), { headers: { "content-type": "text/event-stream; charset=utf-8", "x-request-id": "request-receipt" } });
}
const NoNative = async () => { throw Error("native POST must never run"); };

test("SSE decoder handles byte-split UTF8/CRLF, comments, multiline frames and BOM", () =>
{
	const Events: any[] = [], Decode = new SseDecoder(E => Events.push(E));
	const Bytes = Encoder.encode('\ufeff: keepalive\r\nevent: delta\r\nid: seq-1\r\ndata: {"text":\r\ndata: "数学𝛼"}\r\n\r\n');
	for(const B of Bytes) { Decode.push(Uint8Array.of(B)); } Decode.finish();
	assert.deepEqual(Events, [{ Event: "delta", Id: "seq-1", Data: '{"text":\n"数学𝛼"}' }]);
	const Unterminated: any[] = [], EOF = new SseDecoder(E => Unterminated.push(E)); EOF.push(Encoder.encode("data: lost")); EOF.finish(); assert.equal(Unterminated.length, 0);
	const CR: any[] = [], LastCR = new SseDecoder(E => CR.push(E)); LastCR.push(Encoder.encode("data: complete\r\r")); LastCR.finish(); assert.equal(CR[0].Data, "complete");
});

test("SSE frames and invalid UTF8 are bounded, not silently decoded as a completed response", () =>
{
	assert.throws(() => new SseDecoder(() => {}, 5).push(Encoder.encode("data: too long")), /超过/);
	assert.throws(() => new SseDecoder(() => {}).push(Uint8Array.of(0xff)), /encoded data/i);
});

test("Chat stream emits actual provider chunks, final cumulative usage once and request receipts", async () =>
{
	const Deltas: string[] = [], Bodies: any[] = [];
	const Fetch: typeof fetch = async (Url, Init) =>
	{
		assert.ok(String(Url).endsWith("/chat/completions")); Bodies.push(JSON.parse(String(Init?.body)));
		return fixture_fetch([frame(chat("第一步 ")), frame(chat("$$a+b$$")), frame(chat("", "stop")), frame({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }), frame({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }), frame("[DONE]")])(Url, Init);
	};
	const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch })({ ...Input, OnDelta: T => Deltas.push(T) }, new AbortController().signal);
	assert.deepEqual(Deltas, ["第一步 ", "$$a+b$$"]); assert.equal(Result.Text, Deltas.join("")); assert.equal(Result.Status, "completed");
	assert.equal(Bodies[0].stream, true); assert.deepEqual(Bodies[0].stream_options, { include_usage: true });
	assert.equal(Result.Metadata.Usage?.length, 1); assert.equal(Result.Metadata.Usage?.[0].TotalTokens, 28);
	assert.deepEqual(Result.Metadata.Receipts, [{ RequestId: "request-receipt", ResponseId: "chat-receipt" }]);
	assert.equal(Result.Metadata.Model, "effective-model"); assert.equal(Result.Metadata.Transport, "streaming");
});

test("Responses terminal sequence is deduplicated and incomplete body survives full final envelope", async () =>
{
	const Deltas: string[] = [];
	const Delta = { type: "response.output_text.delta", sequence_number: 1, delta: "proof before limit" };
	const Final = { type: "response.incomplete", sequence_number: 2, response: { id: "response-original", status: "incomplete", model: "actual-responses", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 12 }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "proof before limit" }] }] } };
	const Result = await direct_api(profile({ Provider: "openai" }), Key, NoNative, undefined, { Fetch: fixture_fetch([frame(Delta), frame(Delta), frame(Final), frame(Final)]) })({ ...Input, OnDelta: T => Deltas.push(T) }, new AbortController().signal);
	assert.deepEqual(Deltas, ["proof before limit"]); assert.equal(Result.Text, "proof before limit"); assert.equal(Result.Status, "partial");
	assert.equal(Result.Metadata.Reason, "max_output_tokens"); assert.equal(Result.Metadata.Usage?.length, 1);
});

for(const Mode of ["EOF", "malformed", "invalid-utf8", "error"])
{
	test(`stream ${Mode} retains received body and accurate uncertainty`, async () =>
	{
		const Tail = Mode === "EOF" ? [] : Mode === "malformed" ? ["data: {broken}\n\n"] : Mode === "invalid-utf8" ? [Uint8Array.of(0xff)] : [frame({ error: { code: "provider-error" } })];
		const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch: fixture_fetch([frame(chat("received proof")), ...Tail]) })(Input, new AbortController().signal);
		assert.equal(Result.Text, "received proof"); assert.equal(Result.Status, Mode === "error" ? "partial" : "unknown");
		assert.equal(Result.Metadata.Receipts?.[0].RequestId, "request-receipt");
	});
}

test("stopping real stream preserves body, never claims server cancellation and releases reader", async () =>
{
	const Abort = new AbortController(); let Cancelled = false, Posts = 0;
	const Fetch: typeof fetch = async () =>
	{
		Posts++;
		return new Response(new ReadableStream({ start(C) { C.enqueue(Encoder.encode(frame(chat("partial before stop")))); }, cancel() { Cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
	};
	const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch })({ ...Input, OnDelta: () => Abort.abort() }, Abort.signal);
	assert.equal(Result.Text, "partial before stop"); assert.equal(Result.Status, "unknown"); assert.equal(Result.Metadata.Submission, "unknown");
	assert.equal(Result.Metadata.Wait, "stopped"); assert.equal(Cancelled, true); assert.equal(Posts, 1);
});

test("terminal success cannot be downgraded by an abort arriving after the terminal chunk", async () =>
{
	const Abort = new AbortController();
	const Final = frame(chat("finished proof", "stop")) + frame("[DONE]");
	const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch: fixture_fetch([Final]) })({ ...Input, OnDelta: () => Abort.abort() }, Abort.signal);
	assert.equal(Result.Status, "completed"); assert.equal(Result.Text, "finished proof");
});

test("fetch rejection, HTTP errors and non-SSE response never fall back to a second POST", async () =>
{
	for(const Mode of ["cors", "http", "mime"])
	{
		let Posts = 0, Native = 0;
		const Fetch: typeof fetch = async () => { Posts++; if(Mode === "cors") { throw TypeError("CORS"); } return new Response("{}", { status: Mode === "http" ? 401 : 200, headers: { "content-type": "application/json" } }); };
		const Result = await direct_api(profile(), Key, async () => { Native++; throw Error("must not re-POST"); }, undefined, { Fetch })(Input, new AbortController().signal);
		assert.equal(Posts, 1); assert.equal(Native, 0); assert.equal(Result.Status, Mode === "http" ? "failed" : "unknown");
	}
});

test("first event, inter-event idle and whole-run budgets are independent and preserve partial content", async () =>
{
	for(const Mode of ["first", "idle", "total"])
	{
		let Timer: ReturnType<typeof setInterval> | undefined;
		const Fetch: typeof fetch = async () => new Response(new ReadableStream({ start(C)
		{
			if(Mode !== "first") { C.enqueue(Encoder.encode(frame(chat("initial")))); }
			if(Mode === "total") { Timer = setInterval(() => C.enqueue(Encoder.encode(frame(chat(".")))), 10); }
		}, cancel() { clearInterval(Timer); } }), { headers: { "content-type": "text/event-stream" } });
		const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch, Budget: { FirstEventMs: 60, IdleMs: 60, TotalMs: Mode === "total" ? 120 : 500 } })(Input, new AbortController().signal);
		assert.equal(Result.Status, "unknown"); assert.equal(!!Result.Text, Mode !== "first");
		assert.match(Result.Metadata.Reason!, Mode === "first" ? /首个/ : Mode === "idle" ? /空闲/ : /整体/);
	}
});

test("secret echoed across frame boundaries is redacted before deltas and final metadata", async () =>
{
	const Deltas: string[] = [];
	const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch: fixture_fetch([frame(chat("safe " + Key.slice(0, 7))), frame(chat(Key.slice(7) + " end")), frame(chat("", "stop", { usage: { echo: Key } })), frame("[DONE]")]) })({ ...Input, OnDelta: T => Deltas.push(T) }, new AbortController().signal);
	assert.equal(Deltas.join(""), "safe [redacted] end"); assert.equal(Result.Text, Deltas.join("")); assert.ok(!JSON.stringify(Result).includes(Key));
});

test("streamed history function arguments are assembled exactly and followup retains provider thinking", async () =>
{
	let Posts = 0, Reads = 0;
	const Fetch: typeof fetch = async (Url, Init) =>
	{
		const Body = JSON.parse(String(Init?.body));
		if(++Posts === 1)
		{
			assert.deepEqual(Body.tools.map((T: any) => T.function.name), ["obsidian_history_read"]);
			return fixture_fetch([
				frame({ choices: [{ index: 0, delta: { reasoning_content: "original reasoning", tool_calls: [{ index: 0, id: "call-original", function: { name: "obsidian_history_read", arguments: '{"command":' } }] }, finish_reason: null }] }),
				frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"list"}' } }] }, finish_reason: "tool_calls" }] }), frame("[DONE]")
			])(Url, Init);
		}
		assert.equal(Body.messages.at(-2).reasoning_content, "original reasoning"); assert.equal(Body.messages.at(-1).role, "tool");
		return fixture_fetch([frame(chat("proof after bounded source", "stop")), frame("[DONE]")])(Url, Init);
	};
	const Result = await direct_api(profile(), Key, NoNative, undefined, { Fetch })({ ...Input, HistoryRead: async A =>
	{
		Reads++; assert.deepEqual(A, { command: "list" }); return { success: true, contentItems: [{ type: "inputText", text: "fixed original directory" }] };
	} }, new AbortController().signal);
	assert.equal(Result.Status, "completed"); assert.equal(Result.Text, "proof after bounded source"); assert.equal(Posts, 2); assert.equal(Reads, 1);
});

test("RPC completion and simultaneous stop settle once using an already observed terminal frame", async () =>
{
	const Events: any[] = [];
	let C!: BackendConnection;
	const P = profile();
	C = new BackendConnection(P, direct_api(P, Key, NoNative, undefined, { Fetch: fixture_fetch([frame(chat("proof", "stop")) + frame("[DONE]")]) }), E =>
	{
		Events.push(E);
		if(E.method === "item/agentMessage/delta") { void C.request("turn/interrupt", { threadId: E.params.threadId, turnId: E.params.turnId }); }
	});
	const { thread } = await C.request("thread/start", { clientSessionId: "race-original" });
	const { turn } = await C.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "original" }] }); C.begin_turn(turn.id);
	await new Promise(R => setTimeout(R, 20));
	assert.equal(Events.filter(E => E.method === "turn/completed").length, 1);
	assert.equal(Events.find(E => E.method === "turn/completed").params.turn.status, "completed");
	assert.equal(Events.filter(E => E.method === "backend/result-unknown").length, 0); C.close();
});

test("real loopback HTTP SSE delivers first proof before final body; RPC uses stable item identity", async T =>
{
	let Release!: () => void, TextSeen!: () => void, Posts = 0;
	const Gate = new Promise<void>(R => { Release = R; }), First = new Promise<void>(R => { TextSeen = R; });
	const Server = createServer(async (Req, Res) =>
	{
		Posts++; for await(const _Chunk of Req) { /* Drain the original controlled request. */ }
		Res.writeHead(200, { "content-type": "text/event-stream" }); Res.write(frame(chat("first actual network chunk")));
		await Gate; Res.end(frame(chat(" then conclusion", "stop")) + frame("[DONE]"));
	});
	await new Promise<void>(R => Server.listen(0, "127.0.0.1", R));
	T.after(async () => { Release(); Server.closeAllConnections(); await new Promise<void>(R => Server.close(() => R())); });
	const Address = Server.address(); if(!Address || typeof Address === "string") { throw Error("fixture"); }
	const P = profile(); P.Base = `http://127.0.0.1:${Address.port}`;
	const Events: any[] = [];
	const C = new BackendConnection(P, direct_api(P, Key, NoNative), E => { Events.push(E); if(E.method === "item/agentMessage/delta") { TextSeen(); } });
	const { thread } = await C.request("thread/start", { clientSessionId: "network-original" });
	const { turn } = await C.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "original sum identity" }] });
	C.begin_turn(turn.id);
	await Promise.race([First, new Promise<never>((_, R) => setTimeout(() => R(Error("no incremental text before final")), 3000).unref())]);
	assert.equal(Events.some(E => E.method === "turn/completed"), false); assert.equal(Posts, 1);
	Release();
	for(let I = 0; I < 100 && !Events.some(E => E.method === "turn/completed"); I++) { await new Promise(R => setTimeout(R, 10)); }
	const Result = Events.find(E => E.method === "backend/result").params.result;
	assert.equal(Result.Text, "first actual network chunk then conclusion"); assert.equal(Result.Status, "completed");
	assert.equal(Events.filter(E => E.method === "turn/completed").length, 1);
	assert.equal(new Set(Events.flatMap(E => E.params.itemId ?? E.params.item?.id ?? [])).size, 1); C.close();
});
