import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamCheckpoints, SnapshotQueue } from "../src/runtime/checkpoints";
const wait = (Ms: number) => new Promise(R => setTimeout(R, Ms));

test("T06 old async success cannot delete a newer delta and keys do not overwrite each other", async () =>
{
	const Gate = new StreamCheckpoints(100, 1), Saved: string[] = []; let Release!: () => void;
	Gate.offer("original/a", 1, async () => { await new Promise<void>(R => { Release = R; }); Saved.push("a-old"); });
	Gate.offer("original/a", 1, async () => { Saved.push("a-new"); });
	Gate.offer("original/b", 1, async () => { Saved.push("b-exact"); });
	const Flushed = Gate.flush(); Release(); await Flushed;
	assert.deepEqual(Saved, ["b-exact", "a-old", "a-new"]); assert.equal(Gate.pending, 0); assert.equal(Gate.Stats.checkpoints, 3); await Gate.close();
});

test("T06 failed old write retries only latest captured work and error reporter cannot swallow it", async () =>
{
	let Reject!: (E: Error) => void; const Saved: string[] = [], Gate = new StreamCheckpoints(10, 1, () => { throw Error("reporter failed"); });
	Gate.offer("scope-original/a", 1, () => new Promise<void>((_R, J) => { Reject = J; }));
	Gate.offer("scope-original/a", 1, async () => { Saved.push("latest-original-path"); });
	Reject(Error("old I/O failure")); await wait(50);
	assert.deepEqual(Saved, ["latest-original-path"]); assert.equal(Gate.pending, 0); assert.equal(Gate.Stats.failed, 1); await Gate.close();
});

test("T06 forgotten queued work cannot run after a durable terminal or a reused key", async () =>
{
	const Queue = new SnapshotQueue(), Gate = new StreamCheckpoints(10, 1), Saved: string[] = []; let Release!: () => void;
	const Busy = Queue.enqueue(() => new Promise<void>(R => { Release = R; }));
	Gate.offer("scope/s/t/a", 1, Context => Queue.enqueue(async () => { if(Context.is_current()) { Saved.push("obsolete body"); } }, "scope/s/t/a"));
	const Forgotten = Gate.forget("scope/s/t/a");
	const Terminal = Queue.enqueue(async () => { Saved.push("durable terminal"); });
	Release(); await Promise.all([Busy, Forgotten, Terminal]); await wait(30);
	assert.deepEqual(Saved, ["durable terminal"]); assert.equal(Gate.pending, 0); assert.equal(Gate.Stats.checkpoints, 0);
	Gate.offer("scope/s/t/a", 1, async () => { Saved.push("new instance"); }); await Gate.close(); assert.deepEqual(Saved, ["durable terminal", "new instance"]);
});

test("T06 forget aborts a failing in-flight attempt and never schedules its retry", async () =>
{
	let Reject!: (E: Error) => void, Attempts = 0, Signal: AbortSignal | undefined;
	const Gate = new StreamCheckpoints(5, 1);
	Gate.offer("scope-original/a", 1, Context => { Attempts++; Signal = Context.Signal; return new Promise<void>((_R, J) => { Reject = J; }); });
	const Forgotten = Gate.forget("scope-original/a"); assert.equal(Signal!.aborted, true); Reject(Error("late disk error")); await Forgotten; await wait(30);
	assert.equal(Attempts, 1); assert.equal(Gate.pending, 0); await Gate.close();
});

test("T06 graceful close waits for pending readback, rejects failure and never claims forced-exit persistence", async () =>
{
	const Gate = new StreamCheckpoints(100, 100), Writes: string[] = []; let Resolve!: () => void, Closed = false;
	Gate.offer("original", 1, () => new Promise<void>(R => { Resolve = () => { Writes.push("readback-success"); R(); }; }));
	const Closing = Gate.close().then(() => { Closed = true; }); await wait(5);
	assert.equal(Closed, false); assert.throws(() => Gate.offer("late", 1, () => {}), /关闭/); Resolve(); await Closing;
	assert.deepEqual(Writes, ["readback-success"]); assert.equal(Gate.pending, 0);
	let Attempts = 0; const Failed = new StreamCheckpoints(5, 100);
	Failed.offer("unsaved", 1, async () => { Attempts++; throw Error("persistent disk failure"); });
	await assert.rejects(Failed.close(), /disk failure/); const Count = Attempts; await wait(25);
	assert.equal(Attempts, Count); assert.equal(Failed.pending, 1); assert.equal(Failed.Stats.checkpoints, 0);
});
