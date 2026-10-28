import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare_conflict_resolution, preserve_durable_resolved_messages } from "../src/sync/conflicts";
import { client_sync } from "../src/sync/types";
import type { SessionState } from "../src/sessions";

function state(Text: string): SessionState
{
	return { ActiveId: "s", Sessions: [{ Id: "s", Title: "Original", ThreadId: null, Messages: [{ Id: "a", Role: "assistant", Text }] }], Sync: client_sync("original-scope") };
}
async function fixture(Choice: "local" | "remote" = "remote")
{
	const Local = state("Original local"), Remote = state("Original remote");
	const Conflict = { Key: JSON.stringify(["s", "a"]), Reason: "Original conflict", Local: Local.Sessions[0].Messages[0], Remote: Remote.Sessions[0].Messages[0] };
	const Resolution = await prepare_conflict_resolution("original-scope", Conflict, Choice);
	const Durable = structuredClone(Choice === "local" ? Local : Remote), Data = structuredClone(Choice === "local" ? Remote : Local);
	Durable.Sync!.Resolutions = [Resolution]; Data.Sync!.Resolutions = [Resolution]; return { Data, Durable, Conflict };
}

test("durable decisions preserve the exact chosen body for either choice without changing durable evidence", async () =>
{
	for(const Choice of ["local", "remote"] as const)
	{
		const { Data, Durable } = await fixture(Choice), Before = JSON.stringify(Durable);
		preserve_durable_resolved_messages(Data, Durable);
		assert.deepEqual(Data.Sessions[0].Messages, Durable.Sessions[0].Messages); assert.equal(JSON.stringify(Durable), Before);
	}
});

test("self-reported decisions, opposite decisions, another scope and missing durable bodies cannot choose a replacement", async () =>
{
	const F = await fixture(), Original = JSON.stringify(F.Data.Sessions);
	F.Durable.Sessions[0].Messages[0].Text = "Actual body differs from decision";
	preserve_durable_resolved_messages(F.Data, F.Durable); assert.equal(JSON.stringify(F.Data.Sessions), Original);
	const G = await fixture(); G.Data.Sync!.Resolutions!.push(await prepare_conflict_resolution("original-scope", G.Conflict, "local"));
	preserve_durable_resolved_messages(G.Data, G.Durable); assert.equal(JSON.stringify(G.Data.Sessions), Original);
	const H = await fixture(); H.Durable.Sessions[0].Messages = []; preserve_durable_resolved_messages(H.Data, H.Durable); assert.equal(JSON.stringify(H.Data.Sessions), Original);
	const J = await fixture(); J.Durable.Sync!.Scope = "other-scope"; assert.throws(() => preserve_durable_resolved_messages(J.Data, J.Durable), /作用域/); assert.equal(JSON.stringify(J.Data.Sessions), Original);
	const K = await fixture(); K.Durable.Sync!.Resolutions = []; preserve_durable_resolved_messages(K.Data, K.Durable); assert.equal(JSON.stringify(K.Data.Sessions), Original);
});

test("a later body remains intact with conflict evidence while deletion and same IDs in other sessions stay isolated", async () =>
{
	const { Data, Durable } = await fixture(); Data.Sessions[0].Messages[0].Text = "Later original proof";
	preserve_durable_resolved_messages(Data, Durable); preserve_durable_resolved_messages(Data, Durable);
	assert.equal(Data.Sessions[0].Messages[0].Text, "Later original proof"); assert.equal(Data.Sync!.Conflicts.length, 1);
	assert.equal((Data.Sync!.Conflicts[0].Remote as any).Text, "Original remote");
	const G = await fixture(); G.Data.Sessions.push({ ...structuredClone(G.Data.Sessions[0]), Id: "different-session" }); G.Data.DeletedMessages = [{ SessionId: "s", MessageId: "a" }];
	preserve_durable_resolved_messages(G.Data, G.Durable); assert.ok(G.Data.Sessions.every(S => S.Messages[0].Text === "Original local"));
});
