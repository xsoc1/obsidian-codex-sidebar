import { test } from "node:test";
import assert from "node:assert/strict";
import { new_session, session_stamp, delete_session_plan, prune_sessions, restore_sessions, deleted_session_ids } from "../src/sessions";

function fixture()
{
	const A = new_session("Original A"), B = new_session("Original B");
	A.Messages.push({ Id: "question", Role: "user", Text: "Original question", Context: { Path: "Original.md", Text: "$x=1$", CapturedAt: "original-time" } as any });
	B.ParentId = A.Id; B.Messages = structuredClone(A.Messages);
	return { A, B, State: { Settings: { Model: "original-model" }, Sessions: [A, B], ActiveId: A.Id } };
}

test("confirmed deletion removes only the reviewed session and retains other branches, settings and original snapshots", () =>
{
	const F = fixture(), Before = structuredClone(F.State), Plan = delete_session_plan(F.State, F.A.Id, session_stamp(F.A));
	assert.deepEqual(F.State, Before); assert.deepEqual(Plan.State.Sessions, [F.B]); assert.equal(Plan.State.ActiveId, F.B.Id);
	assert.deepEqual(Plan.State.DeletedSessionIds, [F.A.Id]); assert.deepEqual(Plan.State.Settings, Before.Settings); assert.equal(Plan.State.Sessions[0].ParentId, F.A.Id);
});

test("deleting the last conversation or the current note's bound chat creates a fresh empty replacement", () =>
{
	const F = fixture(), Last = { ...F.State, Sessions: [F.A] };
	const One = delete_session_plan(Last, F.A.Id, session_stamp(F.A)); assert.equal(One.State.Sessions.length, 1); assert.notEqual(One.State.ActiveId, F.A.Id); assert.deepEqual(One.State.Sessions[0].Messages, []);
	const Note = delete_session_plan(F.State, F.A.Id, session_stamp(F.A), "Original note"); assert.equal(Note.State.Sessions.length, 2); assert.equal(Note.State.ActiveId, Note.ReplacementId); assert.equal(Note.State.Sessions.at(-1)!.Title, "Original note");
});

test("an altered or already-deleted conversation refuses the old confirmation", () =>
{
	const F = fixture(), Stamp = session_stamp(F.A); F.A.Messages[0].Text += " edited";
	assert.throws(() => delete_session_plan(F.State, F.A.Id, Stamp), /已变化/);
	assert.throws(() => delete_session_plan(F.State, "missing", Stamp), /已不存在/);
	for(const Value of [null, "invalid", [1], [""], ["bad "]]) { assert.throws(() => deleted_session_ids(Value), /损坏/); }
});

test("local and remote tombstones filter stale snapshots without reviving a deleted note chat", () =>
{
	const F = fixture(), Remote = structuredClone(F.State), Local = delete_session_plan(F.State, F.A.Id, session_stamp(F.A), "Original note").State;
	const Restored = restore_sessions(Local, Remote, [F.A.Id, Local.ActiveId], true);
	assert.ok(!Restored.Sessions.some(S => S.Id === F.A.Id)); assert.equal(Restored.ActiveId, Local.ActiveId); assert.deepEqual(Restored.DeletedSessionIds, [F.A.Id]); assert.deepEqual(Restored.Sessions.find(S => S.Id === F.B.Id), F.B);
	const RemoteDeleted = { ...Remote, DeletedSessionIds: [F.B.Id] };
	const Both = restore_sessions(Local, RemoteDeleted, [Local.ActiveId], true); assert.ok(!Both.Sessions.some(S => [F.A.Id, F.B.Id].includes(S.Id)));
});

test("old data without deletion markers stays unchanged and an independent device scope is unaffected", () =>
{
	const F = fixture(), Normal = prune_sessions(F.State); assert.deepEqual(Normal, F.State); assert.ok(!("DeletedSessionIds" in Normal));
	const Removed = delete_session_plan(F.State, F.A.Id, session_stamp(F.A)).State;
	assert.ok(!prune_sessions(Removed).Sessions.some(S => S.Id === F.A.Id)); assert.ok(prune_sessions(F.State).Sessions.some(S => S.Id === F.A.Id));
});
