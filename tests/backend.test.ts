import assert from "node:assert/strict";
import { test } from "node:test";
import { BackendConnection, type BackendInput } from "../src/backend";
import { backend_profile, backend_identity } from "../src/backend-profile";
import { direct_api } from "../src/direct-api";
import { google_reasoning } from "../src/google-reasoning";
import { agent_text } from "../src/headless-agents";
import { snapshot_instructions, DefaultInstructions } from "../src/prompt";

const Key = "fixture-secret-value";
const Input: BackendInput = { Session: "a-b-c", Messages: [{ Role: "system", Text: "instructions" }, { Role: "user", Text: "$x$", Images: ["data:image/jpeg;base64,AA=="] }] };

test("direct presets use their documented endpoint, auth and image shape; Go keeps a stable session header", async () =>
{
	for(const [Provider, Endpoint] of [
		["openai", "https://api.openai.com/v1/responses"],
		["deepseek", "https://api.deepseek.com/chat/completions"],
		["opencode", "https://opencode.ai/inference/go/openai/v1/chat/completions"],
		["google", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
		["compatible", "https://vendor.example/v1/chat/completions"]
	])
	{
		const Profile = backend_profile({ Kind: "api", Stream: "buffered", Provider, Base: "https://vendor.example/v1", Model: "model/demo", Vision: true });
		assert.equal(Profile.Kind, "api"); if(Profile.Kind !== "api") { throw Error("fixture"); }
		const Generate = direct_api(Profile, Key, async Request =>
		{
			assert.equal(Request.url, Endpoint); assert.equal(Request.headers.Authorization, "Bearer " + Key); assert.ok(!Request.body!.includes(Key));
			if(Provider === "opencode") { assert.equal(Request.headers["x-opencode-session"], "ses_abc"); assert.match(Request.headers["User-Agent"], /Obsidian-Codex-Sidebar/); }
			const Body = JSON.parse(Request.body!); assert.equal(Body.model, "model/demo"); assert.ok(!Body.tools);
			if(Provider === "openai")
			{
				assert.equal(Body.store, false); assert.equal(Body.input[0].role, "developer"); assert.equal(Body.input[1].content[1].image_url, Input.Messages[1].Images![0]);
				return { status: 200, json: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok " + Key }] }] } };
			}
			assert.equal(Body.messages[1].content[1].image_url.url, Input.Messages[1].Images![0]);
			return { status: 200, json: { choices: [{ finish_reason: "stop", message: { content: "ok " + Key } }] } };
		});
		assert.equal((await Generate(Input, new AbortController().signal)).Text, "ok [redacted]");
	}
});

test("custom URLs cannot embed credentials, terminal failures are redacted and never retried", async () =>
{
	for(const Base of ["http://vendor.test/v1", "https://a:b@vendor.test/v1", "https://vendor.test/v1?key=abc", "https://vendor.test/v1/chat/completions"])
	{
		assert.throws(() => backend_profile({ Kind: "api", Stream: "buffered", Provider: "compatible", Base, Model: "fixture" }), /HTTPS/);
	}
	const Profile = backend_profile({ Kind: "api", Stream: "buffered", Provider: "deepseek", Model: "fixture" });
	if(Profile.Kind !== "api") { throw Error("fixture"); }
	let Requests = 0;
	const Generate = direct_api(Profile, Key, async () => { Requests++; return { status: 401, json: { error: Key } }; });
	await assert.rejects(Generate(Input, new AbortController().signal), /未启用图像/);
	assert.equal((await Generate({ ...Input, Messages: [{ Role: "user", Text: "fixture" }] }, new AbortController().signal)).Metadata.Reason, "API HTTP 401. 核对密钥、项目权限及模型可用性");
	assert.equal(Requests, 1);
	assert.notEqual(backend_identity(Profile), backend_identity(backend_profile({ ...Profile, Provider: "google" })));
});

test("Go protocol stays independent of explicit and default effort", async () =>
{
	const Profile = backend_profile({ Kind: "api", Stream: "buffered", Provider: "opencode", Model: "fixture", Vision: true });
	if(Profile.Kind !== "api") { throw Error("fixture"); }
	for(const Format of ["chat", "responses"] as const)
	{
		const Calls: { Url: string; Body: any }[] = [];
		const Generate = direct_api(Profile, Key, async Request =>
		{
			Calls.push({ Url: Request.url, Body: JSON.parse(Request.body!) });
			assert.equal(Request.headers["x-opencode-session"], "ses_abc");
			return Request.url.endsWith("/responses") ? { status: 200, json: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }] } }
				: { status: 200, json: { choices: [{ finish_reason: "stop", message: { content: "ok" } }] } };
		}, { Format, Efforts: ["high", "none"] });
		assert.equal((await Generate({ ...Input, Effort: "high" }, new AbortController().signal)).Text, "ok");
		assert.equal((await Generate(Input, new AbortController().signal)).Text, "ok");
		await assert.rejects(Generate({ ...Input, Effort: "max" }, new AbortController().signal), /不支持/);
		assert.equal(Calls.length, 2);
		if(Format === "chat") { assert.ok(Calls[0].Url.endsWith("/chat/completions")); assert.equal(Calls[0].Body.reasoning_effort, "high"); }
		else { assert.ok(Calls[0].Url.endsWith("/responses")); assert.deepEqual(Calls[0].Body.reasoning, { effort: "high" }); }
		assert.ok(Calls[1].Url.endsWith(Format === "responses" ? "/responses" : "/chat/completions"));
		assert.equal(Calls[1].Body.reasoning_effort, undefined); assert.equal(Calls[1].Body.reasoning, undefined);
	}
});

test("Google exposes exact model-level options and never guesses for an alias or non-chat model", () =>
{
	assert.deepEqual(google_reasoning("models/gemini-3.1-pro-preview")?.Efforts, ["low", "medium", "high"]);
	assert.deepEqual(google_reasoning("gemini-3-pro-preview")?.Efforts, ["low", "high"]);
	assert.deepEqual(google_reasoning("gemini-3.8-flash")?.Efforts, ["low", "medium", "high"]);
	assert.deepEqual(google_reasoning("gemini-3.1-flash-lite")?.Efforts, ["minimal", "low", "medium", "high"]);
	assert.deepEqual(google_reasoning("gemini-2.5-pro")?.Efforts, ["low", "medium", "high"]);
	assert.deepEqual(google_reasoning("gemini-2.5-flash-lite")?.Efforts, ["none", "low", "medium", "high"]);
	for(const Id of ["gemini-flash-latest", "gemini-3.8-flash-tts", "gemini-3.1-flash-lite-image", "gemini-4-future"])
	{
		assert.equal(google_reasoning(Id), undefined);
	}
});

test("DeepSeek and Gemini chat effort requests match each wire contract and preserve the default request", async () =>
{
	for(const Case of [
		{ Provider: "deepseek", Model: "deepseek-flash", Effort: "max", Fields: { thinking: { type: "enabled" }, reasoning_effort: "max" } },
		{ Provider: "deepseek", Model: "deepseek-flash", Effort: "none", Fields: { thinking: { type: "disabled" } } },
		{ Provider: "google", Model: "gemini-3.1-flash-lite", Effort: "minimal", Fields: { extra_body: { google: { thinking_config: { thinking_level: "minimal" } } } } },
		{ Provider: "google", Model: "gemini-2.5-flash-lite", Effort: "none", Fields: { reasoning_effort: "none" } }
	])
	{
		const Profile = backend_profile({ Kind: "api", Stream: "buffered", Provider: Case.Provider, Model: Case.Model, Vision: true });
		if(Profile.Kind !== "api") { throw Error("fixture"); }
		const Bodies: object[] = [];
		const Generate = direct_api(Profile, Key, async Request =>
		{
			assert.equal(Request.url, Profile.Base + "/chat/completions");
			const { model, messages, stream, ...Fields } = JSON.parse(Request.body!);
			assert.equal(model, Case.Model); assert.equal(stream, false); assert.equal(messages[1].content[0].text, "$x$");
			Bodies.push(Fields);
			return { status: 200, json: { choices: [{ finish_reason: "stop", message: { content: "ok" } }] } };
		}, Case.Provider === "google" ? google_reasoning(Case.Model) : { Format: "chat", Efforts: ["none", "low", "high", "max"] });
		const Signal = new AbortController().signal;
		await Generate({ ...Input, Effort: Case.Effort }, Signal);
		await Generate(Input, Signal);
		await assert.rejects(Generate({ ...Input, Effort: "xhigh" }, Signal), /不支持/);
		assert.deepEqual(Bodies, [Case.Fields, {}]);
	}
});

test("the local adapter sends only after binding, and stopped wait archives rather than displays a late answer", async () =>
{
	const Profile = backend_profile({ Kind: "api", Stream: "buffered", Provider: "openai", Model: "fixture" });
	const Events: any[] = [];
	let Release!: (Value: string) => void, Requests = 0;
	const Connection = new BackendConnection(Profile, async ({ Messages }) =>
	{
		Requests++; assert.equal(Messages.at(-1)?.Text, "original");
		return new Promise(Resolve => { Release = Resolve; });
	}, Value => Events.push(Value));
	const { thread } = await Connection.request("thread/start", { clientSessionId: "fixture", developerInstructions: "rules" });
	const { turn } = await Connection.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "original" }] });
	assert.equal(Requests, 0);
	Connection.begin_turn(turn.id); Connection.begin_turn(turn.id);
	await Promise.resolve();
	assert.equal(Requests, 1);
	await Connection.request("turn/interrupt", { threadId: thread.id, turnId: turn.id });
	await new Promise(Resolve => setTimeout(Resolve, 10));
	Release("late answer");
	await new Promise(Resolve => setImmediate(Resolve));
	assert.equal(Events.filter(E => E.method === "backend/result-unknown").length, 1);
	assert.equal(Events.filter(E => E.method === "turn/completed").length, 0);
	assert.equal(Events.find(E => E.method === "backend/result" && E.params.late)?.params.result.Text, "late answer");
	Connection.close();
});

test("alternate backend instructions keep edit rules and admit the source limit", () =>
{
	const Text = snapshot_instructions(DefaultInstructions, "PDF rules");
	assert.match(Text, /最小/); assert.match(Text, /当前未提供 Obsidian 读库/); assert.doesNotMatch(Text, /调用 obsidian_cli_read/);
});

test("CLI decoders require provider-defined terminal success", () =>
{
	assert.equal(agent_text("claude", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "answer" })), "answer");
	assert.equal(agent_text("antigravity", JSON.stringify({ text: "answer" })), "answer");
	assert.equal(agent_text("dsh", '{"type":"session"}\n{"type":"final","reason":{"kind":"completed"},"text":"answer"}'), "answer");
	assert.equal(agent_text("dsh", '{"type":"status","phase":"turn_end","reason":{"kind":"completed"}}\n{"type":"final","text":"answer"}'), "answer");
	assert.throws(() => agent_text("dsh", '{"type":"final","reason":{"kind":"error"},"text":"partial"}'), /未返回/);
	assert.throws(() => agent_text("claude", '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"partial"}'), /未返回/);
});
