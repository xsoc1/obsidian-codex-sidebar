import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonRpcPeer, type RpcMessage } from "../src/rpc";

test("JSONL preserves split UTF-8, coalesced events, and server request IDs", async () =>
{
	const Output: string[] = [];
	const Events: RpcMessage[] = [];
	const Errors: Error[] = [];
	const Peer = new JsonRpcPeer(Data => Output.push(Data), Message => Events.push(Message), ErrorValue => Errors.push(ErrorValue));
	const Request = Peer.request("account/read", {});
	const Id = JSON.parse(Output[0]).id;
	const Data = Buffer.from(JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "数学公式" } }) + "\n" + JSON.stringify({ id: "approval-1", method: "item/commandExecution/requestApproval", params: {} }) + "\n" + JSON.stringify({ id: Id, result: { account: { type: "chatgpt" } } }) + "\n");
	for(let Index = 0; Index < Data.length; Index++)
	{
		Peer.feed(Data.subarray(Index, Index + 1));
	}
	assert.equal((await Request).account.type, "chatgpt");
	assert.equal(Events[0].params.delta, "数学公式");
	assert.equal(Events[1].id, "approval-1");
	assert.equal(Errors.length, 0);
	Peer.close();
});

test("out-of-order replies route correctly and RPC errors reject", async () =>
{
	const Output: string[] = [];
	const Peer = new JsonRpcPeer(Data => Output.push(Data), () => {}, () => {});
	const First = Peer.request("thread/start", {});
	const Second = Peer.request("account/read", {});
	const FirstId = JSON.parse(Output[0]).id;
	const SecondId = JSON.parse(Output[1]).id;
	const Rejected = assert.rejects(First, /model unavailable/);
	Peer.feed(Buffer.from(`${JSON.stringify({ id: SecondId, result: "ready" })}\n${JSON.stringify({ id: FirstId, error: { code: -1, message: "model unavailable" } })}\n`));
	assert.equal(await Second, "ready");
	await Rejected;
	Peer.close();
});

test("disconnect rejects pending work and ignores late frames", async () =>
{
	let Events = 0;
	const Peer = new JsonRpcPeer(() => {}, () => Events++, () => {});
	const Request = Peer.request("turn/start", {});
	const Rejected = assert.rejects(Request, /closed/);
	Peer.close(new Error("closed"));
	Peer.feed(Buffer.from('{"method":"turn/completed","params":{}}\n'));
	await Rejected;
	assert.equal(Events, 0);
	await assert.rejects(Peer.request("test", {}), /已关闭/);
});

test("malformed frames are reported without silently losing following replies", async () =>
{
	const Output: string[] = [];
	const Errors: Error[] = [];
	const Peer = new JsonRpcPeer(Data => Output.push(Data), () => {}, ErrorValue => Errors.push(ErrorValue));
	const Request = Peer.request("initialize", {});
	const Id = JSON.parse(Output[0]).id;
	Peer.feed(Buffer.from(`not-json\nnull\n${JSON.stringify({ id: Id, result: "ok" })}\n`));
	assert.equal(await Request, "ok");
	assert.equal(Errors.length, 2);
	Peer.close();
});

test("timeout does not automatically resend a potentially accepted turn", async () =>
{
	const Output: string[] = [];
	const Peer = new JsonRpcPeer(Data => Output.push(Data), () => {}, () => {});
	await assert.rejects(Peer.request("turn/start", {}, 10), /结果可能未知/);
	assert.equal(Output.length, 1);
	Peer.close();
});
