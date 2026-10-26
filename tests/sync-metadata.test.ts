import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical_json, client_sync, entity_key } from "../src/sync/types";
import { create_send_operation, merge_operations, update_operation } from "../src/sync/operations";
import { merge_sync_metadata } from "../src/sync/metadata";

test("operation terminal disagreements and changed immutable input keep both witnesses even without a caller conflict array", async () =>
{
	const Local = await create_send_operation("original-scope", "s", "q", { Prompt: "Original" }, "original-operation"); Local.Status = "completed"; Local.TurnId = "original-turn";
	const Remote = { ...structuredClone(Local), Status: "cancelled" as const }, Merged = merge_operations([Local], [Remote]);
	assert.equal(Merged[0].Status, "completed"); assert.equal((Merged[0].Conflicts![0].Remote as any).Status, "cancelled");
	const InputConflict = merge_operations([Local], [{ ...Remote, Input: { Prompt: "Original changed" } }]);
	assert.equal((InputConflict[0].Conflicts![0].Remote as any).Input.Prompt, "Original changed"); assert.deepEqual(InputConflict[0].Input, Local.Input);
	const Sync = client_sync("original-scope"); Sync.Operations.push(Local); update_operation(Sync, Local.Id, "failed", { Error: "Original contradictory terminal" });
	assert.equal(Sync.Operations[0].Status, "completed"); assert.equal(Sync.Conflicts.length, 1);
	update_operation(Sync, Local.Id, "completed", { Input: { Prompt: "Original altered" } }); assert.deepEqual(Sync.Operations[0].Input, Local.Input); assert.equal(Sync.Conflicts.length, 2);
});

test("late sync metadata cannot roll back versions, erase new operations or mark a newer local settings edit committed", async () =>
{
	const Current = client_sync("original-scope"), Incoming = client_sync("original-scope"), Key = entity_key("message", "s", "q");
	Current.Revision = 12; Current.Versions[Key] = { Revision: 12, Digest: "new", Origin: Current.Scope }; Current.SettingsDigest = "old-local-baseline"; Current.SettingsRevision = 4;
	Incoming.Revision = 9; Incoming.Versions[Key] = { Revision: 9, Digest: "old", Origin: Current.Scope }; Incoming.SettingsDigest = "submitted-snapshot"; Incoming.SettingsRevision = 7;
	const Old = await create_send_operation(Current.Scope, "s", "q", { Prompt: "Original" }, "old"), New = await create_send_operation(Current.Scope, "s", "q2", { Prompt: "Original two" }, "new");
	Current.Operations = [Old, New]; Incoming.Operations = [{ ...Old, Status: "running", TurnId: "original-turn" }];
	const State = { Settings: { Model: "local-edit-made-during-request" }, Sync: Current }; State.Sync = merge_sync_metadata(State.Sync, Incoming);
	assert.equal(State.Sync.Revision, 12); assert.equal(State.Sync.Versions[Key].Digest, "new"); assert.equal(State.Sync.Operations.length, 2); assert.equal(State.Sync.SettingsDigest, "submitted-snapshot");
	assert.equal(State.Settings.Model, "local-edit-made-during-request");
	const Older = { ...Incoming, SettingsRevision: 3, SettingsDigest: "stale" }; assert.equal(merge_sync_metadata(State.Sync, Older).SettingsDigest, "submitted-snapshot");
	assert.throws(() => merge_sync_metadata(Current, { ...Incoming, Scope: "other" }), /作用域/);
});

test("a newer durable server operation revision can move running to unknown after restart without erasing terminal evidence", async () =>
{
	const Original = await create_send_operation("original-scope", "s", "q", { Prompt: "Original" }, "original-operation");
	const Running = { ...Original, Status: "running" as const, Origin: Original.Scope, Revision: 5, TurnId: "original-turn" }, Unknown = { ...Running, Status: "submission-unknown" as const, Revision: 7 };
	assert.equal(merge_operations([Running], [Unknown])[0].Status, "submission-unknown"); assert.equal(merge_operations([Unknown], [Running])[0].Status, "submission-unknown");
	const Completed = { ...Running, Status: "completed" as const }, Cancelled = { ...Unknown, Status: "cancelled" as const }, Conflict = merge_operations([Completed], [Cancelled])[0];
	assert.equal(Conflict.Status, "completed"); assert.equal(Conflict.Conflicts!.length, 1);
});

test("canonical content ordering is locale-independent for Windows and mobile digests", () =>
{
	assert.equal(canonical_json({ "中": 1, "ä": 2, z: 3, A: 4, a: 5 }), '{"A":4,"a":5,"z":3,"ä":2,"中":1}');
});
