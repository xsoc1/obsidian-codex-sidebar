import { test } from "node:test";
import assert from "node:assert/strict";
import { load_state_file, write_state_file } from "../src/runtime/state-store";
import { SnapshotQueue, StreamCheckpoints } from "../src/runtime/checkpoints";
import { OperationViewIndex } from "../src/runtime/operation-view";
import type { SendOperation } from "../src/sync/types";
import { normalize_outbox, send_intent } from "../src/runtime/outbox";

test("operation display projects scalar state without serializing immutable inputs", () =>
{
	const Index = new OperationViewIndex(), Ops: SendOperation[] = [{ Id: "o", Scope: "s", SessionId: "s", MessageId: "u", Digest: "digest", Status: "running", Input: { get secret() { throw Error("UI accessed input"); } }, Attempted: true }];
	assert.deepEqual(Object.keys(Index.get("o", Ops)!).sort(), ["Attempted", "Error", "Status", "TurnId"]);
	Ops[0].Status = "completed"; assert.equal(Index.get("o", Ops)?.Status, "completed");
	assert.equal(Index.get("o", [{ ...Ops[0], Status: "failed" }])?.Status, "failed");
});

test("slow storage replaces same-message checkpoints, retaining operation barriers and final bytes", async () =>
{
	const Q = new SnapshotQueue(), Writes: string[] = []; let Release!: () => void;
	const Blocked = Q.enqueue(() => new Promise<void>(Resolve => { Release = Resolve; }));
	let Pending: Promise<void> | undefined;
	for(let I = 0; I < 100; I++)
	{
		const Next = Q.enqueue(async () => { Writes.push(`body-${I}`); }, "scope/session/turn/message");
		if(Pending) { assert.equal(Next, Pending); } Pending = Next;
	}
	assert.equal(Q.pending, 2);
	const Attempted = Q.enqueue(async () => { Writes.push("Attempted"); });
	const Later = Q.enqueue(async () => { Writes.push("body-later"); }, "scope/session/turn/message");
	const Other = Q.enqueue(async () => { Writes.push("other-message"); }, "scope/session/turn/other");
	const Final = Q.enqueue(async () => { Writes.push("completed-exact-final"); });
	Release(); await Promise.all([Blocked, Pending, Attempted, Later, Other, Final]);
	assert.deepEqual(Writes, ["body-99", "Attempted", "body-later", "other-message", "completed-exact-final"]);
	assert.equal(Q.Stats.coalesced, 99);
	await assert.rejects(Q.enqueue(async () => { throw Error("disk full"); }), /disk full/);
	await Q.enqueue(async () => { Writes.push("recovered"); });
});

test("alternating body checkpoints stay bounded without crossing a durable barrier or writing older snapshots last", async () =>
{
	const Q = new SnapshotQueue(), Written: number[] = []; let Release!: () => void;
	const Gate = Q.enqueue(() => new Promise<void>(R => { Release = R; })), Jobs: Promise<void>[] = [];
	for(let I = 0; I < 200; I++) { Jobs.push(Q.enqueue(async () => { Written.push(I); }, I % 2 ? "reasoning" : "answer")); }
	assert.equal(Q.pending, 3);
	Jobs.push(Q.enqueue(async () => { Written.push(200); }));
	for(let I = 201; I < 401; I++) { Jobs.push(Q.enqueue(async () => { Written.push(I); }, I % 2 ? "reasoning" : "answer")); }
	assert.equal(Q.pending, 6); Release(); await Promise.all([Gate, ...Jobs]);
	assert.deepEqual(Written, [198, 199, 200, 399, 400]);
});

test("a failed timed bridge body checkpoint retains its latest body until a successful retry", async () =>
{
	let Attempts = 0, Fail = true; const Saved: string[] = [], Errors: unknown[] = [];
	const Gate = new StreamCheckpoints(10, 10_000, E => Errors.push(E));
	Gate.offer("scope/session/turn/message", 1, () => { Attempts++; if(Fail) { throw Error("original disk failure"); } Saved.push("old body"); });
	await new Promise(R => setTimeout(R, 25)); assert.ok(Errors.length); assert.equal(Gate.Stats.checkpoints, 0);
	Gate.offer("scope/session/turn/message", 1, () => { Attempts++; if(Fail) { throw Error("original disk failure"); } Saved.push("latest exact $x=1$"); });
	Fail = false; Gate.flush(); Gate.close();
	assert.deepEqual(Saved, ["latest exact $x=1$"]); assert.equal(Gate.Stats.checkpoints, 1); assert.ok(Attempts >= 2);
});

test("lightweight operation evidence never discards the sole full local intent", async () =>
{
	const Intent = await send_intent("scope", "s", "u", { Prompt: "Original proof" });
	const State = { Outbox: [Intent], Sync: { Operations: [{ Id: Intent.Id, SessionId: "s", MessageId: "u", Input: null, Evidence: { InputBlob: "saved-blob" } }] } };
	normalize_outbox(State); assert.deepEqual(State.Outbox, [Intent]);
});

test("stream checkpoints have a timer tail bound and byte trigger, final flush cancels pending timers", async () =>
{
	const Gate = new StreamCheckpoints(10, 32_768), Bodies: string[] = []; let Body = "";
	for(let I = 0; I < 100; I++) { Body += "x".repeat(1600); const Exact = Body; Gate.offer("s/t/a", 1600, () => Bodies.push(Exact)); }
	Gate.flush(); const Count = Bodies.length;
	assert.equal(Bodies.at(-1), Body); assert.ok(Count <= 5); assert.ok(Bodies.reduce((N, B) => N + B.length, 0) < 500_000);
	await new Promise(R => setTimeout(R, 15)); assert.equal(Bodies.length, Count);
	Gate.offer("s/t/a", 1, () => Bodies.push("timer-tail")); await new Promise(R => setTimeout(R, 20));
	assert.equal(Bodies.at(-1), "timer-tail"); Gate.close();
});

test("an unchanged committed backup is not rewritten before each small state append", async () =>
{
	const State = { Settings: {}, ActiveId: "s", Sessions: [{ Id: "s", Messages: [{ Id: "a", Role: "assistant", Text: "x".repeat(6_000_000) }] }] };
	const Values = new Map([["legacy", JSON.stringify(State)]]); let Written = 0, Read = 0, Writes = 0;
	const Files = { exists: async (P: string) => Values.has(P), read: async (P: string) => { const T = Values.get(P)!; Read += Buffer.byteLength(T); return T; }, write: async (P: string, T: string) => { Written += Buffer.byteLength(T); Writes++; Values.set(P, T); } };
	const Loaded = await load_state_file(Files, "state", "legacy");
	await write_state_file(Files, "state", Loaded);
	Loaded.Sessions[0].Messages[0].Text += "0123456789abcdef";
	await write_state_file(Files, "state", Loaded);
	Written = 0; Read = 0; Writes = 0;
	Loaded.Sessions[0].Messages[0].Text += "0123456789abcdef";
	await write_state_file(Files, "state", Loaded);
	console.log(JSON.stringify({ fixture: "6 MB plus 16 chars", writtenBytes: Written, readBytes: Read, writes: Writes }));
	assert.ok(Written < 18_010_000, `Redundant full backup write: ${Written}`);
	assert.equal(JSON.parse(Values.get("state")!).Sessions[0].Messages[0].Text, Loaded.Sessions[0].Messages[0].Text);
});
