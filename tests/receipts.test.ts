import { test } from "node:test";
import assert from "node:assert/strict";
import { write_late_receipt, apply_late_receipts } from "../src/runtime/receipts";
import { create_send_operation } from "../src/sync/operations";
import { content_digest, client_sync } from "../src/sync/types";
import { send_intent } from "../src/runtime/outbox";

function fixture()
{
	const Values = new Map<string, string>();
	const Files = { exists: async (P: string) => Values.has(P), read: async (P: string) => Values.get(P)!, write: async (P: string, V: string) => { Values.set(P, V); } };
	return { Values, Files, receipt: () => JSON.parse([...Values.values()][0]) };
}

test("late receipts update only the original operation and never replace newer sessions or resurrect deletions", async () =>
{
	const Values = new Map<string, string>(), Files = { exists: async (P: string) => Values.has(P), read: async (P: string) => Values.get(P)!, write: async (P: string, V: string) => { Values.set(P, V); } };
	const O = await create_send_operation("original-scope", "A", "m1", { Prompt: "Original" }), State = { Sessions: [{ Id: "A", Messages: [{ Id: "m1", Text: "Original" }, { Id: "m2", Text: "Newer local content" }] }, { Id: "B", Messages: [] }], Sync: { Operations: [O], Conflicts: [] }, DeletedSessionIds: [] as string[] };
	await write_late_receipt(Files, "A-state", { ...O, Status: "running", TurnId: "late-turn", Result: { turn: { id: "late-turn" } } });
	assert.equal(await apply_late_receipts(Files, "A-state", State), true); assert.equal(State.Sessions[0].Messages.length, 2); assert.equal((State.Sessions[0].Messages[0] as any).TurnId, "late-turn");
	State.Sessions = State.Sessions.filter(S => S.Id !== "A"); State.DeletedSessionIds.push("A");
	await write_late_receipt(Files, "A-state", { ...O, Status: "completed", TurnId: "late-turn" });
	await apply_late_receipts(Files, "A-state", State); assert.equal(State.Sessions.length, 1); assert.equal((O as any).SessionDeleted, true);
});

test("different late terminal results preserve both exact receipts and replay imports conflicts idempotently", async () =>
{
	const F = fixture(), O = await create_send_operation("scope", "A", "m", { Prompt: "Original $x=1$" });
	const Complete = { ...O, Status: "completed", TurnId: "t", Result: { turn: { id: "t", status: "completed" } } }, Cancel = { ...O, Status: "cancelled", TurnId: "t", Error: "Late cancellation" };
	await write_late_receipt(F.Files, "state", Complete); await write_late_receipt(F.Files, "state", Cancel);
	assert.deepEqual(F.receipt().Record, Complete); assert.deepEqual(F.receipt().Conflicts[0].Record, Cancel);
	const State: any = { Sessions: [{ Id: "A", Messages: [{ Id: "m", Text: "Original" }] }], Sync: { ...client_sync("scope"), Operations: [O] } };
	assert.equal(await apply_late_receipts(F.Files, "state", State), true); assert.equal(O.Status, "completed"); assert.equal(State.Sync.Conflicts.length, 1);
	assert.deepEqual(State.Sync.Conflicts[0].Local, Complete); assert.deepEqual(State.Sync.Conflicts[0].Remote, Cancel);
	assert.equal(await apply_late_receipts(F.Files, "state", State), false); assert.equal(State.Sync.Conflicts.length, 1);
	const Key = [...F.Values.keys()][0], Corrupt = F.receipt(); Corrupt.Conflicts[0].Record.Error = "Tampered"; F.Values.set(Key, JSON.stringify(Corrupt));
	const Before = structuredClone(State); await assert.rejects(apply_late_receipts(F.Files, "state", State), /校验失败/); assert.deepEqual(State, Before);
});

test("concurrent terminal arrivals retain all terminal evidence without losing the canonical result", async () =>
{
	const F = fixture(), O = await create_send_operation("scope", "A", "m", { Prompt: "Original" });
	await write_late_receipt(F.Files, "state", { ...O, Status: "completed", TurnId: "original-turn" });
	await Promise.all(["cancelled", "failed"].map(Status => write_late_receipt(F.Files, "state", { ...O, Status, TurnId: "original-turn" })));
	await write_late_receipt(F.Files, "state", { ...O, Status: "running", TurnId: "original-turn" });
	assert.equal(F.receipt().Record.Status, "completed"); assert.deepEqual(F.receipt().Conflicts.map((E: any) => E.Record.Status).sort(), ["cancelled", "failed"]);
});

test("an intent-only durable state can recover a strictly bound operation created just before unload", async () =>
{
	const F = fixture(), Intent = await send_intent("remote-local:original-device", "A", "m", { Prompt: "Original", Run: { Model: "original-choice" } });
	const O = await create_send_operation("remote:verified-actor", Intent.SessionId, Intent.MessageId, Intent.Input, Intent.Id), Received = { ...O, Status: "running", TurnId: "late-turn", Attempted: true };
	assert.notEqual(Intent.Digest, O.Digest); await write_late_receipt(F.Files, "state", Received, Intent);
	assert.equal(F.receipt().SchemaVersion, 1); assert.equal(F.receipt().Promotion.RawIntentDigest, Intent.Digest); assert.equal(F.receipt().Promotion.ScopedDigest, O.Digest);
	const State: any = { Sessions: [{ Id: "A", Messages: [{ Id: "m", Text: "Original", OperationId: Intent.Id }] }], Outbox: [structuredClone(Intent)] };
	assert.equal(await apply_late_receipts(F.Files, "state", State), true); assert.equal(State.Sync.Scope, O.Scope); assert.deepEqual(State.Sync.Operations[0], Received); assert.equal(State.Outbox.length, 0); assert.equal(State.Sessions[0].Messages[0].TurnId, "late-turn");
	const Restarted = JSON.parse(JSON.stringify(State)); assert.equal(await apply_late_receipts(F.Files, "state", Restarted), false); assert.equal(Restarted.Sync.Operations.length, 1);
});

test("promotion rejects missing binding, changed identity, input, digests and device or connection scopes without mutating state", async () =>
{
	const Intent = await send_intent("local-device", "A", "m", { Prompt: "Original" }), O = await create_send_operation("bound-scope", "A", "m", Intent.Input, Intent.Id);
	const Base: any = { Sessions: [{ Id: "A", Messages: [{ Id: "m", Text: "Original" }] }], Outbox: [Intent] };
	const Missing = fixture(); await write_late_receipt(Missing.Files, "state", O); const Unbound = structuredClone(Base);
	await assert.rejects(apply_late_receipts(Missing.Files, "state", Unbound), /作用域|摘要/); assert.deepEqual(Unbound, Base);
	for(const Change of [{ LocalScope: "other-device" }, { SessionId: "B" }, { MessageId: "other" }, { Digest: "a".repeat(64) }, { Input: { Prompt: "changed" } }])
	{
		const F = fixture(); await write_late_receipt(F.Files, "state", O, Intent); const State = structuredClone(Base); Object.assign(State.Outbox[0], Change); const Before = structuredClone(State);
		await assert.rejects(apply_late_receipts(F.Files, "state", State)); assert.deepEqual(State, Before);
	}
	for(const Change of [{ RawIntentDigest: "a".repeat(64) }, { ScopedDigest: "a".repeat(64) }, { Scope: "other-server" }, { LocalScope: "other-device" }, { MessageId: "other" }])
	{
		const F = fixture(); await write_late_receipt(F.Files, "state", O, Intent); const Key = [...F.Values.keys()][0], R = F.receipt(); Object.assign(R.Promotion, Change); F.Values.set(Key, JSON.stringify(R)); const State = structuredClone(Base);
		await assert.rejects(apply_late_receipts(F.Files, "state", State)); assert.deepEqual(State, Base);
	}
	const Other = fixture(); await write_late_receipt(Other.Files, "state", O, Intent); const OtherScope = { ...structuredClone(Base), Sync: client_sync("other-connection") }, Before = structuredClone(OtherScope);
	await assert.rejects(apply_late_receipts(Other.Files, "state", OtherScope), /另一个连接/); assert.deepEqual(OtherScope, Before);
	await assert.rejects(write_late_receipt(fixture().Files, "state", { ...O, SessionId: "changed" }, Intent));
});

test("a stored raw cancellation remains evidence when a late bound result arrives, without resurrecting a deleted session", async () =>
{
	const F = fixture(), Intent = await send_intent("device", "A", "m", { Prompt: "Original" }), Cancel = { ...Intent, Status: "cancelled" as const };
	const O = await create_send_operation("scope", "A", "m", Intent.Input, Intent.Id), Complete = { ...O, Status: "completed", TurnId: "t" };
	await write_late_receipt(F.Files, "state", Cancel); await write_late_receipt(F.Files, "state", Complete, Intent);
	assert.deepEqual(F.receipt().Conflicts[0].Record, Cancel);
	const State: any = { Sessions: [{ Id: "B", Messages: [] }], Outbox: [Cancel], DeletedSessionIds: ["A"] };
	await apply_late_receipts(F.Files, "state", State); assert.equal(State.Sync.Operations[0].SessionDeleted, true); assert.equal(State.Sessions.length, 1); assert.ok(State.Sync.Conflicts.length >= 1); assert.equal(State.Outbox.length, 0);
	assert.equal(await apply_late_receipts(F.Files, "state", State), false);
});

test("an existing local terminal and different late terminal are both retained, and legacy schema one remains readable", async () =>
{
	const F = fixture(), O = await create_send_operation("scope", "A", "m", { Prompt: "Original" }), R = { ...O, Status: "completed", TurnId: "t" };
	const File = "state.receipt-" + (await content_digest(O.Id)).slice(0, 32) + ".json";
	F.Values.set(File, JSON.stringify({ SchemaVersion: 1, Id: O.Id, Digest: O.Digest, Record: R, Checksum: await content_digest(R) }));
	O.Status = "cancelled"; const State: any = { Sessions: [{ Id: "A", Messages: [{ Id: "m", Text: "Original" }] }], Sync: { ...client_sync("scope"), Operations: [O] } };
	await apply_late_receipts(F.Files, "state", State); assert.equal(O.Status, "cancelled"); assert.equal(State.Sync.Conflicts[0].Remote.Status, "completed");
	assert.equal(await apply_late_receipts(F.Files, "state", State), false);
});

test("a raw intent cancellation arriving after its bound receipt keeps both while preserving the scoped result", async () =>
{
	const F = fixture(), Intent = await send_intent("device", "A", "m", { Prompt: "Original" }), O = await create_send_operation("scope", "A", "m", Intent.Input, Intent.Id);
	const R = { ...O, Status: "completed", TurnId: "t" }, Cancel = { ...Intent, Status: "cancelled" as const };
	await write_late_receipt(F.Files, "state", R, Intent); await write_late_receipt(F.Files, "state", Cancel);
	assert.deepEqual(F.receipt().Record, R); assert.deepEqual(F.receipt().Conflicts[0].Record, Cancel);
	const State: any = { Sessions: [{ Id: "A", Messages: [{ Id: "m", Text: "Original" }] }], Outbox: [Intent] };
	await apply_late_receipts(F.Files, "state", State); assert.equal(State.Sync.Operations[0].Status, "completed"); assert.deepEqual(State.Sync.Conflicts[0].Remote, Cancel);
});
