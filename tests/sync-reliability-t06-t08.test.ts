import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamCheckpoints } from "../src/runtime/checkpoints";
import { pending_conflicts, prepare_conflict_resolution } from "../src/sync/conflicts";
import { SyncServerStore } from "../src/sync/server-store";
const wait = (N = 10) => new Promise(R => setTimeout(R, N));

test("T06 asynchronous rejection retains latest work and retries without a new delta", async () =>
{
	let Attempts = 0, Saved = "", Reject!: (E: Error) => void;
	const Errors: unknown[] = [], Gate = new StreamCheckpoints(10, 1, E => Errors.push(E));
	Gate.offer("original/s/t/a", 1, () => { Attempts++; return Attempts === 1 ? new Promise<void>((_R, J) => { Reject = J; }).catch(E => { throw E; }) : Promise.resolve().then(() => { Saved = "exact original $x^2$"; }); });
	assert.equal(Gate.Stats.checkpoints, 0, "Promise pending is not durable success");
	Reject(Error("original asynchronous disk failure")); await wait(60);
	assert.equal(Saved, "exact original $x^2$"); assert.equal(Gate.Stats.checkpoints, 1); assert.ok(Errors.length);
	await Gate.close();
});

test("T07 final decision explicitly supersedes the observed opposing decisions", async () =>
{
	const C = { Key: '["s","a"]', Reason: "original competing proofs", Local: { Id: "a", Role: "assistant", Text: "$x=1$" }, Remote: { Id: "a", Role: "assistant", Text: "$x=2$" } };
	const A = await prepare_conflict_resolution("scope", C, "local"), B = await prepare_conflict_resolution("scope", C, "remote");
	const Final = await (prepare_conflict_resolution as any)("scope", C, "local", [A, B]);
	assert.equal(pending_conflicts([C], [A, B, Final]).length, 0);
});

test("T08 a corrupt immutable blob is rejected rather than returned as valid parts", () =>
{
	const Root = mkdtempSync(join(tmpdir(), "codex-owned-range-"));
	try
	{
		const Store = new SyncServerStore(Root, "original-device"), Id = Store.store_value({ Text: "x".repeat(128 * 1024) });
		const File = join(Root, "original-device-blobs", Id + ".json"), Bytes = readFileSync(File); Bytes[20] ^= 1; writeFileSync(File, Bytes);
		assert.throws(() => Store.blob_part(Id, 0), /摘要|版本|损坏/);
	}
	finally { rmSync(Root, { recursive: true, force: true }); }
});
