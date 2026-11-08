import { test } from "node:test";
import assert from "node:assert/strict";
import { create_send_operation, merge_operations } from "../src/sync/operations";
import { content_digest } from "../src/sync/types";
import { DeltaSyncClient, IncompleteOperationEvidenceError } from "../src/sync/client";
import { merge_sync_metadata } from "../src/sync/metadata";
import { normalize_outbox, send_intent } from "../src/runtime/outbox";
import { operation_evidence_fixture } from "./fixtures/r05-operation-evidence";

test("R05 saved Input and Request retain the pending Result locator through restore, disk restart, sync and full hydration", async () =>
{
	const F = await operation_evidence_fixture(); let C = F.connection();
	try
	{
		await C.connect(); let S: any = await C.restore_state(await F.load());
		assert.equal(S.Sync.Operations[0].Status, "completed"); assert.deepEqual(S.Sync.Operations[0].Input, F.Operation.Input); assert.deepEqual(S.Sync.Operations[0].Request, F.Operation.Request);
		assert.equal(S.Sync.Operations[0].Evidence?.ResultBlob, F.ResultBlob, "known Input must not erase the missing result locator");
		assert.equal(F.counts().ResultReads, 0); await F.save(S); C.close(); await F.restart_bridge();
		C = F.connection(); await C.connect(); S = await C.restore_state(await F.load()); await C.sync_state(S);
		const BeforeMessages = structuredClone(S.Sessions), Complete: any = await C.hydrate_all(S);
		assert.deepEqual(Complete.Sync.Operations[0].Result, F.Result); assert.equal(Complete.Sync.Operations[0].Evidence, undefined);
		assert.deepEqual(Complete.Sessions, BeforeMessages); await F.save(Complete); assert.deepEqual((await F.load()).Sync.Operations[0].Result, F.Result);
		assert.ok(F.counts().ResultReads > 0); assert.equal(F.counts().StatusReads, 0); assert.equal(F.counts().InferencePosts, 0); assert.equal(F.counts().InferenceCalls, 0);
	}
	finally { C.close(); await F.close(); }
});

test("R05 field-wise merge keeps known request and pending result independently of which status wins", async () =>
{
	const O = await create_send_operation("original-scope", "s", "q", { Prompt: "Original proof" }, "original-operation");
	O.Request = { input: "Original request" }; O.RequestDigest = await content_digest(O.Request);
	const Meta: any = { ...structuredClone(O), Input: undefined, Request: undefined, Status: "completed", Evidence: { State: "metadata", InputBlob: await content_digest(O.Input), RequestBlob: await content_digest(O.Request), ResultBlob: await content_digest({ receipt: "Original receipt" }) } };
	for(const [L, R] of [[O, Meta], [Meta, O]])
	{
		const Merged = merge_operations([L], [R])[0]; assert.deepEqual(Merged.Input, O.Input); assert.deepEqual(Merged.Request, O.Request);
		assert.equal(Merged.Evidence?.ResultBlob, Meta.Evidence.ResultBlob); assert.equal(Merged.Status, "completed");
	}
});

test("R05 host-style merge of a fully hydrated export cannot reinstate already verified field locators", async () =>
{
	const F = await operation_evidence_fixture(), C = new DeltaSyncClient(F.Http, F.Operation.Scope);
	try
	{
		const Partial: any = (await C.restore(await F.load())).State, Complete: any = await C.hydrate_all(Partial);
		for(const [L, R] of [[Partial.Sync, Complete.Sync], [Complete.Sync, Partial.Sync]])
		{
			const Merged = merge_sync_metadata(L, R); assert.equal(Merged.Operations[0].Evidence, undefined, "verified Input/Request must not become pending again in the actual export merge"); assert.deepEqual(Merged.Operations[0].Result, F.Result);
		}
		const Reads = F.counts().ResultReads, Again: any = (await C.restore(JSON.parse(JSON.stringify(Complete)))).State;
		assert.equal(Again.Sync.Operations[0].Evidence, undefined); assert.deepEqual(Again.Sync.Operations[0].Result, F.Result); assert.equal(F.counts().ResultReads, Reads);
	}
	finally { await F.close(); }
});

for(const Failure of ["download", "digest"])
{
	test(`R05 ${Failure} failure keeps per-field retry state on disk and recovers without operation_status or inference`, async () =>
	{
		const F = await operation_evidence_fixture(), C = new DeltaSyncClient(F.Http, F.Operation.Scope);
		try
		{
			const Partial: any = (await C.restore(await F.load())).State;
			if(Failure === "download") { F.fail_result(true); } else { F.corrupt_result(true); }
			let FailureState: any;
			await assert.rejects(C.hydrate_all(Partial), E =>
			{
				assert.ok(E instanceof IncompleteOperationEvidenceError); assert.match(E.message, /未生成完整导出/); assert.deepEqual(E.Missing[0].Fields, ["Result"]); FailureState = E.IncompleteState; return true;
			});
			const Pending = FailureState.Sync.Operations[0]; assert.deepEqual(Pending.Input, F.Operation.Input); assert.deepEqual(Pending.Request, F.Operation.Request);
			assert.equal(Pending.Evidence.ResultBlob, F.ResultBlob); assert.equal(Pending.Evidence.InputBlob, undefined); assert.equal(Pending.Evidence.RequestBlob, undefined); assert.equal(Pending.Result, undefined);
			await F.save(FailureState); F.fail_result(false); F.corrupt_result(false);
			const Cold = new DeltaSyncClient(F.Http, F.Operation.Scope), Complete: any = await Cold.hydrate_all(await F.load());
			assert.deepEqual(Complete.Sync.Operations[0].Result, F.Result); assert.equal(Complete.Sync.Operations[0].Evidence, undefined); assert.equal(F.counts().StatusReads, 0); assert.equal(F.counts().InferencePosts, 0);
		}
		finally { await F.close(); }
	});
}

test("R05 source-absent optional fields remain unknown while old bridge records and sole local intent survive", async () =>
{
	const F = await operation_evidence_fixture({ WithoutResult: true, WithoutRequest: true }), C = new DeltaSyncClient(F.Http, F.Operation.Scope);
	try
	{
		const Local = await F.load(); delete Local.Sync.Operations[0].Request; delete Local.Sync.Operations[0].RequestDigest;
		const Intent = await send_intent("original-local-scope", "r05-session", "sole-question", { Prompt: "Original never submitted proof" }); Local.Outbox = [Intent];
		const Legacy = await create_send_operation("legacy:r05-original-device", "legacy-session", "legacy-question", { Prompt: "Original preserved legacy proof" }, "legacy-operation"); Local.Sync.Operations.push(Legacy);
		const Complete: any = await C.hydrate_all(Local); normalize_outbox(Complete);
		assert.deepEqual(Complete.Outbox, [Intent]); assert.deepEqual(Complete.Sync.Operations.find((O: any) => O.Id === Legacy.Id), Legacy);
		const O = Complete.Sync.Operations.find((O: any) => O.Id === F.Operation.Id); assert.equal(O.Status, "completed"); assert.equal(O.Result, undefined); assert.equal(O.Request, undefined); assert.equal(O.Conflicts, undefined); assert.equal(O.Evidence, undefined);
		assert.equal(F.counts().ResultReads, 0); assert.equal(F.counts().InferencePosts, 0); assert.equal(F.counts().StatusReads, 0);
	}
	finally { await F.close(); }
});

test("R05 pending Conflicts loads independently without replacing already known local audit or Result", async () =>
{
	const F = await operation_evidence_fixture(), C = new DeltaSyncClient(F.Http, F.Operation.Scope);
	try
	{
		const LocalConflict = { Key: "original-local-audit", Reason: "Original local evidence", Local: "local original", Remote: "remote original" }, RemoteConflict = { ...LocalConflict, Key: "original-remote-audit", Reason: "Original remote evidence" };
		const S: any = (await C.restore(await F.load())).State, O = S.Sync.Operations[0]; O.Conflicts = [LocalConflict]; O.Evidence.ConflictsBlob = F.store_value([RemoteConflict]);
		const Complete: any = await C.hydrate_all(S), Saved = Complete.Sync.Operations[0];
		assert.deepEqual(Saved.Conflicts, [LocalConflict, RemoteConflict]); assert.deepEqual(Saved.Result, F.Result); assert.equal(Saved.Evidence, undefined);
		const Again: any = (await C.restore(JSON.parse(JSON.stringify(Complete)))).State; assert.deepEqual(Again.Sync.Operations[0].Conflicts, Saved.Conflicts); assert.equal(Again.Sync.Operations[0].Evidence, undefined);
	}
	finally { await F.close(); }
});

test("R05 conflicting known Input remains immutable even when either side has another unloaded field", async () =>
{
	const O = await create_send_operation("original-scope", "s", "q", { Prompt: "Original proof" }, "original-operation");
	const L = { ...O, Evidence: { State: "metadata" as const, ResultBlob: await content_digest({ receipt: "original" }) } }, R = { ...structuredClone(L), Input: { Prompt: "Changed proof" } };
	const Merged = merge_operations([L], [R])[0]; assert.deepEqual(Merged.Input, O.Input); assert.equal(Merged.Conflicts!.length, 1); assert.deepEqual((Merged.Conflicts![0].Remote as any).Input, R.Input); assert.equal(Merged.Evidence?.ResultBlob, L.Evidence.ResultBlob);
});

test("R05 input digest and result turn identity failures retain their own locator and verified neighboring fields", async () =>
{
	for(const Field of ["Input", "Result"] as const)
	{
		const F = await operation_evidence_fixture();
		try
		{
			const Http = async (P: string, M: string, B?: unknown) =>
			{
				const V = await F.Http(P, M, B); if(P.startsWith("/operations?offset=")) { for(const O of V.operations) { if(Field === "Input") { O.Digest = "f".repeat(64); } else { O.TurnId = "different-original-turn"; } } } return V;
			};
			const C = new DeltaSyncClient(Http, F.Operation.Scope), Local = await F.load(); Local.Sync.Operations = [];
			await assert.rejects(C.hydrate_all(Local), E =>
			{
				assert.ok(E instanceof IncompleteOperationEvidenceError); const O = E.IncompleteState.Sync!.Operations[0];
				assert.equal(O.Evidence?.[Field === "Input" ? "InputBlob" : "ResultBlob"], Field === "Input" ? F.InputBlob : F.ResultBlob);
				if(Field === "Result") { assert.deepEqual(O.Input, F.Operation.Input); assert.deepEqual(O.Request, F.Operation.Request); assert.equal(O.Result, undefined); }
				return true;
			});
		}
		finally { await F.close(); }
	}
});

test("R05 restore and export retain operation deletion markers and never resurrect a deleted question", async () =>
{
	const F = await operation_evidence_fixture(), C = new DeltaSyncClient(F.Http, F.Operation.Scope);
	try
	{
		const Local = await F.load(); Local.DeletedMessages = [{ SessionId: F.Operation.SessionId, MessageId: F.Operation.MessageId }]; Local.Sync.Operations[0].SessionDeleted = true;
		const Complete: any = await C.hydrate_all(Local), O = Complete.Sync.Operations[0]; assert.equal(O.MessageDeleted, true); assert.equal(O.SessionDeleted, true);
		assert.deepEqual(O.Input, F.Operation.Input); assert.deepEqual(O.Result, F.Result); assert.deepEqual(Complete.DeletedMessages, Local.DeletedMessages);
		assert.equal(Complete.Sessions[0].Messages.length, 1); assert.equal(Complete.Sessions[0].Messages[0].Id, "r05-answer"); assert.equal(Complete.Sessions[0].Messages[0].Text, F.Local.Sessions[0].Messages[1].Text);
	}
	finally { await F.close(); }
});
