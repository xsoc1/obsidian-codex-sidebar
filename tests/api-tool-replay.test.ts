import assert from "node:assert/strict";
import { test } from "node:test";
import { direct_api } from "../src/direct-api";
import { backend_profile, type BackendProfile } from "../src/backend-profile";
import type { BackendInput } from "../src/backend";
import { ApiOpaqueBudget } from "../src/api-result";
import { createServer } from "node:http";

const Key = "opaque-fixture-secret";
const Encoder = new TextEncoder();
const Input: BackendInput = { Session: "opaque-operation", Messages: [{ Role: "user", Text: "Check the saved finite identity." }] };
const Signature = "opaque+/数学𝛼==";
const Tool = { id: "original-call", type: "function", function: { name: "obsidian_history_read", arguments: '{"command":"list"}' }, extra_content: { google: { thought_signature: Signature } } };
function profile(Stream: "auto" | "buffered", Extra: object = {}): Extract<BackendProfile, { Kind: "api" }>
{
	const P = backend_profile({ Kind: "api", Provider: "google", Model: "fixture", Stream, ...Extra });
	if(P.Kind !== "api") { throw Error("fixture"); } return P;
}
const frame = (Value: unknown) => `data: ${typeof Value === "string" ? Value : JSON.stringify(Value)}\r\n\r\n`;
const chunk = (Delta: object, Finish: string | null = null) => ({ id: "original-response", choices: [{ index: 0, delta: Delta, finish_reason: Finish }] });
function sse(Values: unknown[], ByteSplit = false): Response
{
	const Bytes = Encoder.encode(Values.map(V => frame(V)).join(""));
	return new Response(new ReadableStream({ start(C)
	{
		if(ByteSplit) { for(const B of Bytes) { C.enqueue(Uint8Array.of(B)); } }
		else { C.enqueue(Bytes); }
		C.close();
	} }), { headers: { "content-type": "text/event-stream", "x-request-id": "original-request" } });
}
const completed = (Text = "Checked identity.") => ({ id: "final-response", choices: [{ message: { content: Text }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
const tool_response = (Tools: any[] = [Tool]) => ({ id: "original-response", choices: [{ message: { content: "Reading original. ", tool_calls: Tools }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
const read = async () => ({ success: true, contentItems: [{ type: "inputText", text: "saved original directory" }] });

for(const Stream of ["auto", "buffered"] as const)
{
	test(`Gemini ${Stream} replays the same opaque signature, identity, arguments and position in the serialized continuation`, async () =>
	{
		const Bodies: any[] = []; let Reads = 0;
		const Reply = (Body: string) =>
		{
			Bodies.push(JSON.parse(Body));
		};
		const Driver = direct_api(profile(Stream), Key, async R =>
		{
			Reply(R.body!); return { status: 200, json: Bodies.length === 1 ? tool_response() : completed() };
		}, undefined, { Fetch: async (_U, Init) =>
		{
			Reply(String(Init?.body));
			return Bodies.length === 1 ? sse([
				chunk({ content: "Reading original. ", tool_calls: [{ index: 0, ...Tool, extra_content: undefined }] }),
				chunk({ tool_calls: [{ index: 0, extra_content: Tool.extra_content }] }, "tool_calls"),
				{ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }, "[DONE]"
			], true) : sse([chunk({ content: "Checked identity." }, "stop"), { choices: [], usage: completed().usage }, "[DONE]"]);
		} });
		const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
		assert.deepEqual(Bodies[1].messages.at(-2).tool_calls, [Tool]);
		assert.equal(Result.Status, "completed"); assert.equal(Result.Text, "Reading original. Checked identity.");
		assert.equal(Bodies.length, 2); assert.equal(Reads, 1); assert.equal(Result.Metadata.Usage?.length, 2);
		assert.ok(!JSON.stringify(Result).includes(Signature));
	});
}

test("successful history read followed by provider 400 preserves bounded, redacted protocol error rather than a key hint", async () =>
{
	let Posts = 0, Reads = 0;
	const Driver = direct_api(profile("buffered"), Key, async () =>
	{
		Posts++;
		return Posts === 1 ? { status: 200, json: tool_response() } : { status: 400, json: { error: { code: "INVALID_ARGUMENT", message: `Function call is missing a thought_signature. token=${Key}; thought_signature=${Signature}` } } };
	});
	const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Reads, 1); assert.equal(Result.Text, "Reading original. ");
	assert.match(Result.Metadata.Reason!, /历史读取完成.*后续模型请求失败/);
	assert.match(Result.Metadata.Reason!, /INVALID_ARGUMENT/);
	assert.ok(!JSON.stringify(Result).includes(Key)); assert.ok(!JSON.stringify(Result).includes(Signature));
});

test("late and repeated identical signatures remain atomic; index order and sequential steps are replayed unchanged", async () =>
{
	const First = { ...Tool, id: "first-position" }, Second = { ...Tool, id: "second-position", extra_content: undefined }, Next = { ...Tool, id: "next-step", extra_content: { google: { thought_signature: "opaque-next-step==" } } };
	let Posts = 0; const Bodies: any[] = [], Reads: unknown[] = [];
	const Driver = direct_api(profile("auto"), Key, async () => { throw Error("no buffered fallback"); }, undefined, { Fetch: async (_U, Init) =>
	{
		Posts++; Bodies.push(JSON.parse(String(Init?.body)));
		if(Posts === 1) { return sse([
			chunk({ content: "First step. ", tool_calls: [{ index: 1, ...Second }, { index: 0, ...First, extra_content: undefined }] }),
			chunk({}, "tool_calls"),
			chunk({ tool_calls: [{ index: 0, extra_content: First.extra_content }] }),
			chunk({ tool_calls: [{ index: 0, extra_content: First.extra_content }] }), "[DONE]"
		]); }
		if(Posts === 2) { return sse([chunk({ content: "Second step. ", tool_calls: [{ index: 0, ...Next }] }, "tool_calls"), "[DONE]"]); }
		return sse([chunk({ content: "Finished." }, "stop"), "[DONE]"]);
	} });
	const Result = await Driver({ ...Input, HistoryRead: async A => { Reads.push(A); return read(); } }, new AbortController().signal);
	assert.equal(Posts, 3); assert.equal(Reads.length, 3); assert.equal(Result.Status, "completed");
	assert.equal(Result.Text, "First step. Second step. Finished.");
	const Replay = Bodies[2].messages.slice(-5);
	assert.deepEqual(Replay[0].tool_calls, JSON.parse(JSON.stringify([First, Second])));
	assert.deepEqual(Replay.slice(1, 3).map((M: any) => M.tool_call_id), [First.id, Second.id]);
	assert.deepEqual(Replay[3].tool_calls, [Next]); assert.equal(Replay[4].tool_call_id, Next.id);
	assert.deepEqual(Reads, Array(3).fill({ command: "list" }));
});

for(const Mode of ["signature-conflict", "identity-conflict", "invalid-signature"])
{
	test(`${Mode} retains partial body, blocks host reads and never retries`, async () =>
	{
		let Posts = 0, Reads = 0;
		const Conflict = Mode === "identity-conflict" ? { id: "different-identity" } : { extra_content: { google: { thought_signature: Mode === "invalid-signature" ? { signature: Signature } : "different-opaque==" } } };
		const Driver = direct_api(profile("auto"), Key, async () => { throw Error("no buffered fallback"); }, undefined, { Fetch: async () =>
		{
			Posts++; return sse([chunk({ content: "Already received proof. ", tool_calls: [{ index: 0, ...Tool }] }), chunk({ tool_calls: [{ index: 0, ...Conflict }] }, "tool_calls"), "[DONE]"]);
		} });
		const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
		assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Already received proof. ");
		assert.match(Result.Metadata.Reason!, Mode === "invalid-signature" ? /格式无效/ : /冲突/);
		assert.equal(Posts, 1); assert.equal(Reads, 0); assert.ok(!JSON.stringify(Result).includes(Signature));
	});
}

for(const Stream of ["auto", "buffered"] as const)
{
	for(const Mode of ["length", "utf8", "total", "count"])
	{
		test(`${Stream} signature ${Mode} budget stops without truncating and keeps prior body`, async () =>
		{
			const S = Mode === "length" ? "x".repeat(ApiOpaqueBudget.MaxChars + 1) : Mode === "utf8" ? "数".repeat(Math.ceil(ApiOpaqueBudget.MaxFieldUtf8Bytes / 3)) : "x".repeat(ApiOpaqueBudget.MaxFieldUtf8Bytes);
			const Tools = Array.from({ length: Mode === "count" ? 9 : Mode === "total" ? 5 : 1 }, (_, I) => ({ ...Tool, id: `bounded-${I}`, extra_content: { google: { thought_signature: S } } }));
			let Posts = 0, Reads = 0;
			const Driver = direct_api(profile(Stream), Key, async () => { Posts++; return { status: 200, json: tool_response(Tools) }; }, undefined, { Fetch: async () =>
			{
				Posts++; return sse([chunk({ content: "Reading original. " }), chunk({ tool_calls: Tools.map((T, index) => ({ index, ...T })) }, "tool_calls"), "[DONE]"]);
			} });
			const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
			assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. ");
			assert.match(Result.Metadata.Reason!, /预算|数量|索引/); assert.equal(Posts, 1); assert.equal(Reads, 0);
			assert.ok(!JSON.stringify(Result).includes(S));
		});
	}
}

test("operation-wide opaque budget includes signatures from all sequential steps", async () =>
{
	let Posts = 0, Reads = 0;
	const Driver = direct_api(profile("buffered"), Key, async () =>
	{
		Posts++; return { status: 200, json: tool_response(Array.from({ length: Posts === 1 ? 3 : 2 }, (_, I) => ({ ...Tool, id: `step-${Posts}-${I}`, extra_content: { google: { thought_signature: `${Posts}-${I}-` + "x".repeat(60000) } } }))) };
	});
	const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Reads, 3); assert.equal(Result.Status, "partial");
	assert.equal(Result.Text, "Reading original. Reading original. "); assert.match(Result.Metadata.Reason!, /操作预算/);
});

test("buffered cumulative response bytes include opaque extensions while retaining observed text and usage", async () =>
{
	let Posts = 0;
	const First = tool_response(), Last = completed("Final body before local budget.");
	const MaxBytes = Math.max(Encoder.encode(JSON.stringify(First)).byteLength, Encoder.encode(JSON.stringify(Last)).byteLength) + 1;
	const Driver = direct_api(profile("buffered"), Key, async () => ({ status: 200, json: ++Posts === 1 ? First : Last }), undefined, { Budget: { MaxBytes } });
	const Result = await Driver({ ...Input, HistoryRead: read }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. Final body before local budget.");
	assert.equal(Result.Metadata.Usage?.length, 2); assert.match(Result.Metadata.Reason!, /累计超过字节预算/);
});

test("continuation request budget uses serialized UTF8 bytes including the exact signature", async () =>
{
	let Posts = 0, Reads = 0;
	const Driver = direct_api(profile("buffered"), Key, async () =>
	{
		Posts++; return { status: 200, json: tool_response([{ ...Tool, extra_content: { google: { thought_signature: "x".repeat(60000) } } }]) };
	});
	const Result = await Driver({ ...Input, Messages: [{ Role: "user", Text: "数".repeat(4180000) }], HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
	assert.equal(Posts, 1); assert.equal(Reads, 1); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. ");
	assert.match(Result.Metadata.Reason!, /后续输入超过预算/);
});

test("stop during a successful history read prevents further host calls and continuation inference", async () =>
{
	let Posts = 0, Reads = 0; const Abort = new AbortController();
	const Driver = direct_api(profile("buffered"), Key, async () => { Posts++; return { status: 200, json: tool_response([Tool, { ...Tool, id: "must-not-read" }]) }; });
	const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; Abort.abort(); return read(); } }, Abort.signal);
	assert.equal(Posts, 1); assert.equal(Reads, 1); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. ");
});

test("late buffered tool request after deadline stays partial and never executes history or inference", async () =>
{
	let Release!: (Value: any) => void, Posts = 0, Reads = 0; const Late: any[] = [];
	const Driver = direct_api(profile("buffered"), Key, () => { Posts++; return new Promise(R => { Release = R; }); }, undefined, { Budget: { TotalMs: 20 } });
	const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); }, OnLateResult: R => Late.push(R) }, new AbortController().signal);
	assert.equal(Result.Status, "unknown"); Release({ status: 200, json: tool_response() }); await new Promise(R => setImmediate(R));
	assert.equal(Late.length, 1); assert.equal(Late[0].Status, "partial"); assert.equal(Late[0].Text, "Reading original. ");
	assert.match(Late[0].Metadata.Reason, /工具尚未执行/); assert.equal(Posts, 1); assert.equal(Reads, 0);
});

test("streaming HTTP protocol failure after history read is bounded and sanitized without buffered fallback", async () =>
{
	let Posts = 0, Native = 0; const Metadata: any[] = [];
	const Driver = direct_api(profile("auto"), Key, async () => { Native++; throw Error("must not fallback"); }, undefined, { Fetch: async () =>
	{
		Posts++;
		if(Posts === 1) { return sse([chunk({ content: "Reading original. ", tool_calls: [{ index: 0, ...Tool }] }, "tool_calls"), "[DONE]"]); }
		return new Response(JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: `Missing thought_signature; token=${Key}; thought_signature=${Signature}; bad_url=https://example.test/${Key}; ` + "details ".repeat(200) } }), { status: 400 });
	} });
	const Result = await Driver({ ...Input, HistoryRead: read, OnMetadata: M => Metadata.push(M) }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Native, 0); assert.equal(Result.Text, "Reading original. "); assert.equal(Result.Status, "failed");
	assert.match(Result.Metadata.Reason!, /历史读取完成.*后续模型请求失败.*400.*INVALID_ARGUMENT/);
	assert.ok(Result.Metadata.Reason!.length < 600); assert.ok(!JSON.stringify([Result, Metadata]).includes(Key)); assert.ok(!JSON.stringify([Result, Metadata]).includes(Signature));
});

test("Responses streaming continuation replays complete output items including encrypted reasoning in original order", async () =>
{
	const Output = [{ type: "reasoning", id: "reasoning-original", encrypted_content: "opaque-responses-reasoning==", summary: [] }, { type: "function_call", id: "function-original", call_id: "responses-tool", name: "obsidian_history_read", arguments: '{"command":"list"}' }];
	const Bodies: any[] = [];
	const Driver = direct_api(profile("auto", { Provider: "openai" }), Key, async () => { throw Error("no fallback"); }, undefined, { Fetch: async (_U, Init) =>
	{
		Bodies.push(JSON.parse(String(Init?.body)));
		return sse([{ type: "response.completed", response: { status: "completed", id: `responses-${Bodies.length}`, output: Bodies.length === 1 ? Output : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Responses conclusion." }] }], usage: { input_tokens: 8, output_tokens: 4 } } }]);
	} });
	const Result = await Driver({ ...Input, HistoryRead: read }, new AbortController().signal);
	assert.deepEqual(Bodies[1].input.slice(-3, -1), Output); assert.equal(Bodies[1].input.at(-1).call_id, "responses-tool");
	assert.equal(Result.Status, "completed"); assert.equal(Result.Text, "Responses conclusion."); assert.equal(Result.Metadata.Usage?.length, 2);
	assert.ok(!JSON.stringify(Result).includes(Output[0].encrypted_content!));
});

test("stream traffic budget is cumulative across tool rounds and retains earlier chunks", async () =>
{
	let Posts = 0, Reads = 0;
	const First = [chunk({ content: "Reading original. ", tool_calls: [{ index: 0, ...Tool }] }, "tool_calls"), "[DONE]"];
	const Last = [chunk({ content: "More received proof. " }), chunk({ content: "tail".repeat(60) }, "stop"), "[DONE]"];
	const Size = (Values: unknown[]) => Encoder.encode(Values.map(V => frame(V)).join("")).byteLength;
	const MaxBytes = Size(First) + Size([Last[0]]) + 1;
	assert.ok(Size(First) < MaxBytes && Size(Last) < MaxBytes);
	const Driver = direct_api(profile("auto"), Key, async () => { throw Error("no fallback"); }, undefined, { Budget: { MaxBytes }, Fetch: async () =>
	{
		Posts++;
		if(Posts === 1) { return sse(First); }
		return new Response(new ReadableStream({ start(C) { for(const V of Last) { C.enqueue(Encoder.encode(frame(V))); } C.close(); } }), { headers: { "content-type": "text/event-stream" } });
	} });
	const Result = await Driver({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Reads, 1); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. More received proof. ");
	assert.match(Result.Metadata.Reason!, /累计超过字节预算/);
});

test("failed version read is not described as successful when the next model request fails", async () =>
{
	let Posts = 0;
	const Driver = direct_api(profile("buffered"), Key, async () => ++Posts === 1 ? { status: 200, json: tool_response() } : { status: 400, json: { error: { code: "INVALID_ARGUMENT", message: "Invalid protocol field" } } });
	const Result = await Driver({ ...Input, HistoryRead: async () => ({ success: false, contentItems: [{ type: "inputText", text: "body version mismatch" }] }) }, new AbortController().signal);
	assert.equal(Posts, 2); assert.match(Result.Metadata.Reason!, /历史工具已返回失败结果/); assert.doesNotMatch(Result.Metadata.Reason!, /历史读取完成/);
});

test("SSE provider error after history read keeps partial proof, bounded explanation and original usage", async () =>
{
	let Posts = 0;
	const Driver = direct_api(profile("auto"), Key, async () => { throw Error("no fallback"); }, undefined, { Fetch: async () => ++Posts === 1
		? sse([chunk({ content: "Reading original. ", tool_calls: [{ index: 0, ...Tool }] }, "tool_calls"), { choices: [], usage: { prompt_tokens: 5 } }, "[DONE]"])
		: sse([chunk({ content: "Partial conclusion. " }), { error: { code: "INVALID_ARGUMENT", message: `thought_signature=${Signature}; token=${Key}` } }]) });
	const Result = await Driver({ ...Input, HistoryRead: read }, new AbortController().signal);
	assert.equal(Posts, 2); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Reading original. Partial conclusion. ");
	assert.match(Result.Metadata.Reason!, /历史读取完成.*INVALID_ARGUMENT/); assert.equal(Result.Metadata.Usage?.[0].InputTokens, 5);
	assert.ok(!JSON.stringify(Result).includes(Signature)); assert.ok(!JSON.stringify(Result).includes(Key));
});

test("opaque replay is confined to the frozen endpoint/model and this invocation, never generic history or authority", async () =>
{
	let Posts = 0; const Bodies: any[] = [], URLs: string[] = [], P = profile("buffered");
	const Driver = direct_api(P, Key, async R =>
	{
		Posts++; URLs.push(R.url); Bodies.push(JSON.parse(R.body!));
		return { status: 200, json: Posts === 1 ? tool_response([{ ...Tool, authority: "shell", extra_content: { google: { thought_signature: Signature, permission: "write" }, other: "untrusted" } }]) : completed() };
	});
	const OriginalModel = P.Model, OriginalBase = P.Base;
	assert.equal((await Driver({ ...Input, HistoryRead: async () => { P.Model = "changed-model"; P.Base = "https://other.example/v1"; return read(); } }, new AbortController().signal)).Status, "completed");
	assert.deepEqual(Bodies[1].messages.at(-2).tool_calls, [Tool]);
	assert.equal((await Driver({ ...Input, Session: "new-operation" }, new AbortController().signal)).Status, "completed");
	assert.equal(Posts, 3); assert.ok(URLs.every(U => U === OriginalBase + "/chat/completions")); assert.ok(Bodies.every(B => B.model === OriginalModel));
	assert.ok(!JSON.stringify(Bodies[2]).includes(Signature)); assert.ok(!JSON.stringify(Input).includes(Signature));
});

test("signature echoed in usage is redacted before streamed metadata and stored results", async () =>
{
	const Metadata: any[] = []; let Posts = 0;
	const Driver = direct_api(profile("auto"), Key, async () => { throw Error("no fallback"); }, undefined, { Fetch: async () => ++Posts === 1
		? sse([chunk({ tool_calls: [{ index: 0, ...Tool }] }, "tool_calls"), { choices: [], usage: { prompt_tokens: 5, echo: Signature } }, "[DONE]"])
		: sse([chunk({ content: "Final proof." }, "stop"), "[DONE]"]) });
	const Result = await Driver({ ...Input, HistoryRead: read, OnMetadata: M => Metadata.push(M) }, new AbortController().signal);
	assert.equal(Result.Status, "completed"); assert.equal(Result.Metadata.Usage?.[0].InputTokens, 5);
	assert.ok(!JSON.stringify([Result, Metadata]).includes(Signature));
});

test("real loopback HTTP SSE tool continuation preserves the late signature in the actual second POST", async T =>
{
	let Posts = 0, Reads = 0; const Bodies: any[] = [];
	const Server = createServer(async (Req, Res) =>
	{
		let Body = ""; for await(const Bytes of Req) { Body += Bytes.toString("utf8"); }
		Posts++; Bodies.push(JSON.parse(Body));
		if(Posts === 1)
		{
			Res.writeHead(200, { "content-type": "text/event-stream" });
			Res.write(frame(chunk({ content: "Reading original. ", tool_calls: [{ index: 0, ...Tool, extra_content: undefined }] })));
			Res.end(frame(chunk({ tool_calls: [{ index: 0, extra_content: Tool.extra_content }] }, "tool_calls")) + frame("[DONE]")); return;
		}
		const Valid = JSON.stringify(Bodies[1].messages.at(-2).tool_calls) === JSON.stringify([Tool]);
		Res.writeHead(Valid ? 200 : 400, { "content-type": Valid ? "text/event-stream" : "application/json" });
		Res.end(Valid ? frame(chunk({ content: "Checked identity." }, "stop")) + frame("[DONE]") : JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: "Function call is missing a thought_signature." } }));
	});
	await new Promise<void>(R => Server.listen(0, "127.0.0.1", R));
	T.after(async () => { Server.closeAllConnections(); await new Promise<void>(R => Server.close(() => R())); });
	const Address = Server.address(); if(!Address || typeof Address === "string") { throw Error("fixture"); }
	const P = profile("auto"); P.Base = `http://127.0.0.1:${Address.port}`;
	const Result = await direct_api(P, Key, async () => { throw Error("no fallback"); })({ ...Input, HistoryRead: async () => { Reads++; return read(); } }, new AbortController().signal);
	assert.deepEqual(Bodies[1].messages.at(-2).tool_calls, [Tool]); assert.equal(Posts, 2); assert.equal(Reads, 1);
	assert.equal(Result.Status, "completed"); assert.equal(Result.Text, "Reading original. Checked identity.");
});

test("Google numeric error code and status remain distinct, bounded and sanitized", async () =>
{
	const Driver = direct_api(profile("buffered"), Key, async () => ({ status: 400, json: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Function call is missing a thought_signature." } } }));
	const Result = await Driver(Input, new AbortController().signal);
	assert.equal(Result.Status, "failed"); assert.match(Result.Metadata.Reason!, /400\/INVALID_ARGUMENT.*missing a thought_signature/);
});

test("Responses failed envelope preserves a sanitized provider explanation and partial output", async () =>
{
	const Driver = direct_api(profile("buffered", { Provider: "openai" }), Key, async () => ({ status: 200, json: { id: "failed-receipt", status: "failed", error: { code: "server_error", message: `Invalid request: token=${Key}` }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Partial Responses proof." }] }] } }));
	const Result = await Driver(Input, new AbortController().signal);
	assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "Partial Responses proof."); assert.match(Result.Metadata.Reason!, /server_error/);
	assert.ok(!JSON.stringify(Result).includes(Key));
});

test("HTTP errors without supplier code or explanation retain the original hint in both transports", async () =>
{
	for(const Stream of ["auto", "buffered"] as const)
	{
		for(const Value of [undefined, null, {}, { error: Key }, { error: {} }, { error: { message: "" } }])
		{
			let Posts = 0;
			const Driver = direct_api(profile(Stream), Key, async () => { Posts++; return { status: 401, json: Value }; }, undefined, { Fetch: async () => { Posts++; return new Response(JSON.stringify(Value), { status: 401 }); } });
			const Result = await Driver(Input, new AbortController().signal);
			assert.equal(Result.Metadata.Reason, "API HTTP 401. 核对密钥、项目权限及模型可用性"); assert.equal(Posts, 1);
		}
	}
});

test("HTTP errors with only supplier code or only explanation retain bounded sanitized details", async () =>
{
	for(const Stream of ["auto", "buffered"] as const)
	{
		for(const Error of [{ code: "INVALID_ARGUMENT" }, { message: `Missing thought_signature; token=${Key}` }])
		{
			const Driver = direct_api(profile(Stream), Key, async () => ({ status: 400, json: { error: Error } }), undefined, { Fetch: async () => new Response(JSON.stringify({ error: Error }), { status: 400 }) });
			const Result = await Driver(Input, new AbortController().signal);
			assert.match(Result.Metadata.Reason!, "code" in Error ? /INVALID_ARGUMENT/ : /Missing thought_signature/);
			assert.ok(!JSON.stringify(Result).includes(Key)); assert.ok(Result.Metadata.Reason!.length < 600);
		}
	}
});
