import { test } from "node:test";
import assert from "node:assert/strict";
import { list_api_models } from "../src/api-models";
import type { ApiProvider } from "../src/backend-profile";
import type { BrowserRequest } from "../src/browser-http";

const Key = "fixture-not-an-api-key";

test("API catalogs use the provider's documented GET endpoint, with no credential on the public Go catalog", async () =>
{
	const Cases: [ApiProvider, string][] = [
		["openai", "https://api.openai.com/v1/models"],
		["deepseek", "https://api.deepseek.com/models"],
		["opencode", "https://opencode.ai/inference/go/v1/models"],
		["google", "https://generativelanguage.googleapis.com/v1beta/openai/models"],
		["compatible", "https://proxy.example/api/v1/models"]
	];
	for(const [Provider, Url] of Cases)
	{
		const Calls: BrowserRequest[] = [];
		const Models = await list_api_models(Provider, " https://proxy.example/api/v1/ ", Provider === "opencode" ? "" : Key, async Request =>
		{
			Calls.push(Request);
			return { status: 200, json: { data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-b" }, { id: "bad id" }, {}, null] } };
		});
		assert.deepEqual(Models, [{ Id: "model-a" }, { Id: "model-b" }]);
		assert.deepEqual(Calls, [{ url: Url, method: "GET", headers: Provider === "opencode" ? { Accept: "application/json" } : {
			Accept: "application/json", Authorization: "Bearer " + Key
		} }]);
	}
});

test("Go advertises only allowlisted effort values on an implemented native wire format", async () =>
{
	const Reasoning = { reasoning: { supported: true, effort: ["max", "low", "max", "unexpected", 3] } };
	const Data = [
		{ id: "chat", api: { "chat-completions": {} }, capabilities: Reasoning },
		{ id: "responses", api: { responses: {} }, capabilities: Reasoning },
		{ id: "messages", api: { messages: {} }, capabilities: Reasoning },
		{ id: "no-levels", api: { "chat-completions": {} }, capabilities: { reasoning: { supported: true } } }
	];
	const Send = async () => ({ status: 200, json: { data: Data } });
	assert.deepEqual(await list_api_models("opencode", "", "", Send), [
		{ Id: "chat", Reasoning: { Format: "chat", Efforts: ["max", "low"] } },
		{ Id: "messages" },
		{ Id: "no-levels" },
		{ Id: "responses", Reasoning: { Format: "responses", Efforts: ["max", "low"] } }
	]);
	assert.ok((await list_api_models("deepseek", "", Key, Send)).every(Model => !Model.Reasoning));
});

test("DeepSeek uses per-model supported levels and does not infer options for legacy IDs", async () =>
{
	const Models = await list_api_models("deepseek", "", Key, async () => ({ status: 200, json: { data: [
		{ id: "deepseek-flash", effort: { supported_levels: ["low", "high", "max", "low", "xhigh"], default_level: "high" } },
		{ id: "deepseek-v4-pro", effort: { supported_levels: ["high", "max"] } },
		{ id: "deepseek-chat" },
		{ id: "unknown", effort: { default_level: "high" } }
	] } }));
	assert.deepEqual(Models, [
		{ Id: "deepseek-chat" },
		{ Id: "deepseek-flash", Reasoning: { Format: "chat", Efforts: ["none", "low", "high", "max"] } },
		{ Id: "deepseek-v4-pro", Reasoning: { Format: "chat", Efforts: ["none", "high", "max"] } },
		{ Id: "unknown" }
	]);
});

test("API catalog rejects invalid config before networking and exposes only safe, actionable failures", async () =>
{
	const Never = async () => assert.fail("must not send a request");
	await assert.rejects(list_api_models("compatible", "http://example.test/v1", Key, Never), /HTTPS/);
	await assert.rejects(list_api_models("compatible", "https://example.test/v1?secret=x", Key, Never), /HTTPS/);
	await assert.rejects(list_api_models("deepseek", "", "", Never), /API Key/);
	for(const [Status, Message] of [[401, /API Key/], [403, /权限/], [404, /不提供/], [429, /频繁/]] as const)
	{
		await assert.rejects(list_api_models("compatible", "https://example.test", Key, async () =>
			({ status: Status, json: { error: Key } })), (E: Error) => Message.test(E.message) && !E.message.includes(Key));
	}
	await assert.rejects(list_api_models("deepseek", "", Key, async () => { throw new Error(Key); }),
		(E: Error) => /网络/.test(E.message) && !E.message.includes(Key));
	await assert.rejects(list_api_models("deepseek", "", Key, async () => ({ status: 200, json: { models: [] } })), /不|未返回/);
	assert.deepEqual(await list_api_models("deepseek", "", Key, async () => ({ status: 200, json: { data: [{ id: Key }] } })), []);
});
