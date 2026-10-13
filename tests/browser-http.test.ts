import { test } from "node:test";
import assert from "node:assert/strict";
import { browser_http } from "../src/browser-http";

test("mobile HTTP preserves Unicode JSON, sends pairing only in headers, and omits cookies", async () =>
{
	const Body = JSON.stringify({ text: "中文公式 $x^2$" });
	const Result = await browser_http({ url: "https://example.test/state", method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: Body }, async (Url, Params) =>
	{
		assert.equal(Url, "https://example.test/state");
		assert.equal(Params?.body, Body);
		assert.equal(Params?.credentials, "omit");
		assert.equal(Params?.redirect, "error");
		assert.equal((Params?.headers as Record<string, string>).Authorization, "Bearer fixture");
		return new Response(JSON.stringify({ cursor: 0 }), { status: 200 });
	});
	assert.deepEqual(Result, { status: 200, json: { cursor: 0 } });
});

test("a stalled upload is aborted once and never retried", async () =>
{
	let Calls = 0;
	let Aborted = false;
	await assert.rejects(browser_http({ url: "https://example.test/state", method: "POST", headers: {}, body: "{}", timeout: 10 }, async (_Url, Params) =>
	{
		Calls++;
		return new Promise<Response>((_Resolve, Reject) =>
		{
			Params!.signal!.addEventListener("abort", () => { Aborted = true; Reject(new Error("aborted")); }, { once: true });
		});
	}), /请求超时.*不会自动重发/);
	assert.equal(Calls, 1);
	assert.equal(Aborted, true);
});

test("the timeout covers response-body reading as well as response headers", async () =>
{
	await assert.rejects(browser_http({ url: "https://example.test/info", method: "GET", headers: {}, timeout: 10 }, async (_Url, Params) =>
	{
		const ResponseValue = new Response("{}");
		ResponseValue.json = () => new Promise((_Resolve, Reject) =>
		{
			Params!.signal!.addEventListener("abort", () => Reject(new Error("aborted body")), { once: true });
		});
		return ResponseValue;
	}), /请求超时/);
});
