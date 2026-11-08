import { test } from "node:test";
import assert from "node:assert/strict";
import { ResultSaves } from "../src/runtime/result-saves";
import { preserve_terminal_messages } from "../src/runtime/terminal-messages";
import { client_sync } from "../src/sync/types";

test("result saves keep failed observations after bounded automatic attempts and only retry storage on demand", async () =>
{
	let Attempts = 0, Fail = true;
	const Saves = new ResultSaves<{ Text: string }>(() => {}, 1, 2);
	await Saves.retain("original", { Text: "完整原始数学说明" }, async () => { Attempts++; if(Fail) { throw Error("Original storage failure"); } });
	for(let I = 0; I < 50 && Attempts < 2; I++) { await new Promise(R => setTimeout(R, 2)); }
	assert.equal(Attempts, 2); assert.equal(Saves.pending, 1); assert.equal(Saves.values[0].Value.Text, "完整原始数学说明");
	await new Promise(R => setTimeout(R, 10)); assert.equal(Attempts, 2);
	Fail = false; await Saves.retry(); assert.equal(Attempts, 3); assert.equal(Saves.pending, 0); assert.equal(Saves.Stats.saved, 1);
	await Saves.close();
});

test("different result observations are independent barriers and close does not claim failed bytes durable", async () =>
{
	const Saves = new ResultSaves<string>(() => {}, 60_000, 1);
	await Saves.retain("first", "partial original", async () => { throw Error("Unwritable"); });
	await Saves.retain("second", "complete original", async () => {});
	assert.equal(Saves.pending, 1); assert.equal(Saves.values[0].Value, "partial original");
	await Saves.close(); assert.equal(Saves.pending, 1); assert.equal(Saves.Stats.saved, 1); assert.equal(Saves.values[0].Saving, false);
});

const state = (): any => ({ Sessions: [{ Id: "s", Title: "Original", ThreadId: null, Messages: [{ Id: "q", Role: "user", Text: "原问题", TurnId: "t" }] }], ActiveId: "s", Sync: client_sync("original-scope") });
test("durable terminal preservation adds a missing bound body in turn order and promotes completed over a stale unknown", () =>
{
	const Old = state(), Durable = state(), Reply = { Id: "answer", Role: "assistant", Text: "原完整证明", TurnId: "t", CompletionStatus: "completed" };
	Durable.Sessions[0].Messages.push(Reply); Old.Sessions[0].Messages.push({ Id: "later", Role: "user", Text: "后来内容" });
	preserve_terminal_messages(Old, Durable); assert.deepEqual(Old.Sessions[0].Messages.map((M: any) => M.Id), ["q", "answer", "later"]);
	Old.Sessions[0].Messages[1] = { ...Reply, Text: "old body", CompletionStatus: "unknown" };
	preserve_terminal_messages(Old, Durable); assert.equal(Old.Sessions[0].Messages[1].Text, "原完整证明");
});

test("terminal preservation respects deleted messages, unloaded histories and different scopes", () =>
{
	for(const Kind of ["deleted", "unloaded", "scope"])
	{
		const Old = state(), Durable = state(); Durable.Sessions[0].Messages.push({ Id: "answer", Role: "assistant", Text: "原证明", TurnId: "t", CompletionStatus: "completed" });
		if(Kind === "deleted") { Old.DeletedMessages = [{ SessionId: "s", MessageId: "answer" }]; }
		if(Kind === "unloaded") { Old.Sync.History = { s: { Status: "unloaded", Revision: 1 } }; }
		if(Kind === "scope") { Old.Sync.Scope = "different-scope"; }
		preserve_terminal_messages(Old, Durable); assert.equal(Old.Sessions[0].Messages.some((M: any) => M.Id === "answer"), false);
	}
});
