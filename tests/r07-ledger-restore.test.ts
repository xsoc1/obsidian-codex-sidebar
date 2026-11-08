import { test } from "node:test";
import assert from "node:assert/strict";
import { restore_sessions, type SessionState } from "../src/sessions";
import { plan_history_input, read_history_page } from "../src/history-budget";
import { capture_history_ledger, record_history_read } from "../src/history-ledger";
import type { ChatMessage } from "../src/history";
import { client_sync, content_digest, entity_key } from "../src/sync/types";

async function fixture()
{
	const Identity = { Scope: "original-scope", SessionId: "session", OperationId: "operation" }, Proof: ChatMessage = { Id: "proof", Role: "assistant", Text: "# 引理的完整证明\n\n" + "保留原假设并逐项积分估计. ".repeat(1800), CompletionStatus: "completed" };
	const User: ChatMessage = { Id: "question", Role: "user", Text: "解释该估计并保留原路线", OperationId: Identity.OperationId, Prompt: "Original immutable request", Context: { Path: "Original.md", Text: "原假设", CapturedAt: "original-time", Truncated: false } as any };
	User.InputLedger = capture_history_ledger(plan_history_input([Proof], { MaxUtf8Bytes: 24000, HistoryReadAvailable: true, HistoryReadBodyVersionsAvailable: true }).Ledger, [Proof], Identity);
	const BeforeVersion = { Revision: 19, Origin: Identity.Scope, Digest: await content_digest(User) }; User.SyncVersion = BeforeVersion;
	const Local: SessionState = { ActiveId: "session", Sessions: [{ Id: "session", Title: "Original", ThreadId: "thread", Messages: [Proof, User] }], Sync: client_sync(Identity.Scope) };
	Local.Sync!.Versions[entity_key("message", "session", User.Id)] = BeforeVersion;
	const Remote = structuredClone(Local), Updated = Remote.Sessions[0].Messages[1];
	const First = { command: "read", message_id: Proof.Id, length: 12000 }, R1 = await read_history_page("session", [Proof, User], First, Identity.Scope), Body = JSON.parse(R1.contentItems[0].text);
	Updated.InputLedger = record_history_read(Updated.InputLedger!, Identity, First, R1);
	const Second = { ...First, offset: 12000, length: 10400, version: Body.version }, R2 = await read_history_page("session", [Proof, User], Second, Identity.Scope);
	Updated.InputLedger = record_history_read(Updated.InputLedger, Identity, Second, R2);
	delete Updated.SyncVersion; Updated.SyncVersion = { Revision: 22, Origin: Identity.Scope, Digest: await content_digest(Updated) };
	Remote.Sync!.Versions[entity_key("message", "session", User.Id)] = Updated.SyncVersion;
	return { Identity, Local, Remote, User, Updated };
}

test("R07 restore retains two actually read pages from a newer verified server user without changing original input", async () =>
{
	const F = await fixture(), Result = restore_sessions(F.Local, F.Remote, [], false), User = Result.Sessions[0].Messages[1];
	assert.equal(User.InputLedger!.ReadRecords?.length, 2);
	assert.deepEqual(User.InputLedger!.ReadRecords!.map(R => [R.From, R.To]), [[0, 12000], [12000, 22400]]);
	assert.equal(User.Prompt, F.User.Prompt); assert.deepEqual(User.Context, F.User.Context); assert.deepEqual(User.Quote, F.User.Quote); assert.equal(User.Text, F.User.Text);
	const { ReadRecords: _R, ReadRecordsTruncated: _T, ...Plan } = User.InputLedger!; assert.deepEqual(Plan, F.User.InputLedger);
	const Reopened = JSON.parse(JSON.stringify(Result)); assert.equal(restore_sessions(Reopened, F.Local, [], false).Sessions[0].Messages[1].InputLedger!.ReadRecords!.length, 2);
});

test("R07 restore refuses unknown, older, cross-origin, cross-operation and changed-plan metadata", async () =>
{
	const F = await fixture();
	const Cases: ((M: ChatMessage) => void)[] = [
		M => { delete M.SyncVersion; }, M => { M.SyncVersion!.Revision = 19; }, M => { M.SyncVersion!.Revision = 18; },
		M => { M.SyncVersion!.Origin = "other-source"; }, M => { M.SyncVersion!.Digest = "unverified"; },
		M => { M.InputLedger!.Identity!.OperationId = "another-operation"; }, M => { M.InputLedger!.Identity!.SessionId = "another-session"; }, M => { M.InputLedger!.Identity!.Scope = "another-scope"; },
		M => { M.InputLedger!.ActualUtf8Bytes++; }, M => { M.InputLedger!.IncludedMessageIds = ["another-message"]; },
		M => { M.InputLedger!.ReadRecords![0].OperationId = "another-operation"; }, M => { M.InputLedger!.ReadRecords![0].To = 16001; },
		M => { M.InputLedger!.ReadRecords![0].BodyVersion = "directory:not-a-body"; }, M => { (M.InputLedger!.ReadRecords![0] as any).Text = "unbounded source must not enter metadata"; }
	];
	for(const Mutate of Cases)
	{
		const Remote = structuredClone(F.Remote); Mutate(Remote.Sessions[0].Messages[1]);
		const User = restore_sessions(F.Local, Remote, [], false).Sessions[0].Messages[1];
		assert.deepEqual(User.InputLedger, F.User.InputLedger); assert.equal(User.Prompt, F.User.Prompt); assert.deepEqual(User.SyncVersion, F.User.SyncVersion);
	}
	const NoBaseline = structuredClone(F.Local); delete NoBaseline.Sessions[0].Messages[1].SyncVersion;
	assert.deepEqual(restore_sessions(NoBaseline, F.Remote, [], false).Sessions[0].Messages[1].InputLedger, F.User.InputLedger);
	const ChangedInput = structuredClone(F.Remote); ChangedInput.Sessions[0].Messages[1].Prompt = "different original request";
	const Refused = restore_sessions(F.Local, ChangedInput, [], false); assert.deepEqual(Refused.Sessions[0].Messages[1].InputLedger, F.User.InputLedger); assert.equal(Refused.Sync!.Conflicts.length, 1);
});

test("R07 a previously acknowledged same server version repairs the old user-metadata merge omission", async () =>
{
	const F = await fixture(); F.Local.Sessions[0].Messages[1].SyncVersion = structuredClone(F.Updated.SyncVersion);
	const Restored = restore_sessions(F.Local, F.Remote, [], false).Sessions[0].Messages[1];
	assert.equal(Restored.InputLedger!.ReadRecords!.length, 2); assert.equal(Restored.Prompt, F.User.Prompt);
	const DifferentDigest = structuredClone(F.Remote); DifferentDigest.Sessions[0].Messages[1].SyncVersion!.Digest = "f".repeat(64);
	assert.deepEqual(restore_sessions(F.Local, DifferentDigest, [], false).Sessions[0].Messages[1].InputLedger, F.User.InputLedger);
});

test("R07 newer successful evidence merges idempotently with local pages, preserves labels and keeps the 64-page bound", async () =>
{
	const F = await fixture(), Local = structuredClone(F.Local), Remote = structuredClone(F.Remote);
	Local.Sessions[0].Messages[1].InputLedger!.ReadRecords = [structuredClone(F.Updated.InputLedger!.ReadRecords![0])];
	Remote.Sessions[0].Messages[1].InputLedger!.MaterialLabels![0].Label = "later display label must not rewrite the original label";
	let Result = restore_sessions(Local, Remote, [], false);
	assert.equal(Result.Sessions[0].Messages[1].InputLedger!.ReadRecords!.length, 2);
	assert.deepEqual(Result.Sessions[0].Messages[1].InputLedger!.MaterialLabels, F.User.InputLedger!.MaterialLabels);
	Result = restore_sessions(JSON.parse(JSON.stringify(Result)), Remote, [], false); assert.equal(Result.Sessions[0].Messages[1].InputLedger!.ReadRecords!.length, 2);
	const Base = F.Updated.InputLedger!.ReadRecords![0];
	Local.Sessions[0].Messages[1].InputLedger!.ReadRecords = Array.from({ length: 64 }, (_, I) => ({ ...Base, From: I, To: I + 1, Utf8Bytes: 3 }));
	Remote.Sessions[0].Messages[1].InputLedger!.ReadRecords = [{ ...Base, From: 64, To: 65, Utf8Bytes: 3 }];
	const Bounded = restore_sessions(Local, Remote, [], false).Sessions[0].Messages[1].InputLedger!;
	assert.equal(Bounded.ReadRecords!.length, 64); assert.equal(Bounded.ReadRecordsTruncated, true);
});
