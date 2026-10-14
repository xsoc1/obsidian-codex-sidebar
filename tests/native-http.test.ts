import { test } from "node:test";
import assert from "node:assert/strict";
import { native_http } from "../src/native-http";

test("native HTTP uses the supplied Obsidian API once, retaining explicit authentication and Unicode", async () =>
{
	const Params = { url: "https://example.test/rpc", method: "POST", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify({ text: "中文 $x$" }) };
	let Calls = 0;
	const Result = await native_http(Params, async Value => { Calls++; assert.equal(Value, Params); return { status: 200, json: { text: "中文" } }; });
	assert.equal(Calls, 1);
	assert.deepEqual(Result.json, { text: "中文" });
});

test("uncancellable native requests stop waiting without retries or treating late completion as success", async () =>
{
	let Resolve!: (Value: { status: number; json: unknown }) => void;
	let Calls = 0;
	const Pending = native_http({ url: "https://example.test/info", method: "GET", headers: {} }, () => { Calls++; return new Promise(Value => { Resolve = Value; }); }, 10);
	await assert.rejects(Pending, /原生网络请求超时.*不会自动重发/);
	Resolve({ status: 200, json: { late: true } });
	await assert.rejects(Pending, /超时/);
	assert.equal(Calls, 1);
});
