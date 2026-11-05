import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncServerStore, BlobReaderLimits } from "../src/sync/server-store";
import { DeltaSyncClient } from "../src/sync/client";
import { content_digest, SyncBudgets } from "../src/sync/types";
import { RemoteBridge, token_hash } from "../src/bridge";

function fixture()
{
	const Root = mkdtempSync(join(tmpdir(), "codex-owned-ranges-")), Store = new SyncServerStore(Root, "original-device");
	return { Root, Store, file: (Id: string) => join(Root, "original-device-blobs", Id + ".json"), async close() { await Store.close(); rmSync(Root, { recursive: true, force: true }); } };
}
for(const Size of [1024 * 1024, 8 * 1024 * 1024, 32 * 1024 * 1024])
{
	test(`T08 ${Size / 1024 / 1024} MiB uses exactly N range bytes plus one separately counted integrity scan`, async () =>
	{
		const F = fixture();
		try
		{
			const Value = { Text: "x".repeat(Size - 11) }, Id = F.Store.store_value(Value), Count = Math.ceil(Size / SyncBudgets.blobChunkBytes), Start = performance.now(), Parts: Buffer[] = [];
			let Version: string | undefined;
			for(let I = 0; I < Count; I++)
			{
				const Part = await F.Store.blob_part_async(Id, I); Version ??= Part.version;
				assert.equal(Part.version, Version); assert.equal(Part.count, Count); assert.equal(Part.index, I); assert.equal(Part.bytes, Size); Parts.push(Buffer.from(Part.data, "base64"));
			}
			const Stats = F.Store.blob_reader_stats(); assert.equal(Stats.RangeBytes, Size); assert.equal(Stats.IntegrityScanBytes, Size); assert.equal(Stats.IntegrityScans, 1); assert.equal(Stats.OpenHandles, 1);
			assert.equal(await content_digest(JSON.parse(Buffer.concat(Parts).toString("utf8"))), Id);
			await F.Store.blob_part_async(Id, Count - 1); assert.equal(F.Store.blob_reader_stats().IntegrityScans, 1);
			console.log(JSON.stringify({ fixtureMiB: Size / 1024 / 1024, baselineAlgorithmFullFileRequestedBytes: Size * Count, rangeReadBytes: Stats.RangeBytes, additionalIntegrityScanBytes: Stats.IntegrityScanBytes, rangeReads: Stats.RangeReads, elapsedMs: Math.round(performance.now() - Start), peakHandles: Stats.PeakOpenHandles }));
		}
		finally { await F.close(); assert.equal(F.Store.blob_reader_stats().OpenHandles, 0); }
	});
}

test("T08 boundary lengths and invalid digest/index are exact; short reads never return a part", async () =>
{
	const F = fixture();
	try
	{
		for(const Size of [2, 65_535, 65_536, 65_537, 131_071])
		{
			const Value = Size === 2 ? {} : { Text: "x".repeat(Size - 11) }, Id = F.Store.store_value(Value), Count = Math.ceil(Size / 65_536);
			const Last = F.Store.blob_part(Id, Count - 1); assert.equal(Buffer.from(Last.data, "base64").length, Size - 65_536 * (Count - 1));
			assert.throws(() => F.Store.blob_part(Id, Count), /分页/); assert.throws(() => F.Store.blob_part(Id, -1), /分页/); assert.throws(() => F.Store.blob_part(Id, 0.5), /分页/);
		}
		assert.throws(() => F.Store.blob_part("../wrong", 0), /摘要/);
		const Id = F.Store.store_value({ Text: "x".repeat(131_072) }); await F.Store.blob_part_async(Id, 0);
		const Original = (F.Store as any).read_range.bind(F.Store);
		(F.Store as any).read_range = (R: any, B: Buffer, Offset: number, Length: number, Scan: boolean, Async: boolean) => { if(!Scan) { truncateSync(F.file(Id), Offset + Length - 1); } return Original(R, B, Offset, Length, Scan, Async); };
		await assert.rejects(F.Store.blob_part_async(Id, 1), /short read/); assert.equal(F.Store.blob_reader_stats().ShortReads, 1); assert.equal(F.Store.blob_reader_stats().ActiveReads, 0);
	}
	finally { await F.close(); }
});

test("T08 truncation, replacement and same-length corruption invalidate a verified handle", async () =>
{
	for(const Failure of ["truncate", "replace", "corrupt"])
	{
		const F = fixture();
		try
		{
			const Id = F.Store.store_value({ Text: "x".repeat(131_072) }), File = F.file(Id); await F.Store.blob_part_async(Id, 0);
			if(Failure === "truncate") { truncateSync(File, 64); }
			else if(Failure === "replace") { const Original = readFileSync(File); renameSync(File, File + ".original"); writeFileSync(File, Original); }
			else { const Changed = readFileSync(File); Changed[65_536 + 40] ^= 1; writeFileSync(File, Changed); }
			await assert.rejects(F.Store.blob_part_async(Id, 1), /版本|替换|截断|摘要/, Failure); assert.equal(F.Store.blob_reader_stats().ActiveReads, 0);
		}
		finally { await F.close(); }
	}
});

test("T08 handles, integrity versions, concurrent buffers and canceled readers stay bounded", async () =>
{
	const F = fixture();
	try
	{
		for(let I = 0; I < BlobReaderLimits.verifiedVersions + 8; I++) { const Id = F.Store.store_value({ Original: I }); await F.Store.blob_part_async(Id, 0); }
		let Stats = F.Store.blob_reader_stats(); assert.equal(Stats.OpenHandles, BlobReaderLimits.handles); assert.equal(Stats.VerifiedVersions, BlobReaderLimits.verifiedVersions);
		const Id = F.Store.store_value({ Text: "x".repeat(8 * 1024 * 1024) }), Jobs = Array.from({ length: BlobReaderLimits.concurrentReads }, (_, I) => F.Store.blob_part_async(Id, I));
		await assert.rejects(F.Store.blob_part_async(Id, 0), /并发/); await Promise.all(Jobs); Stats = F.Store.blob_reader_stats(); assert.equal(Stats.ActiveReads, 0); assert.ok(Stats.PeakActiveReads <= BlobReaderLimits.concurrentReads);
		const Another = F.Store.store_value({ Text: "y".repeat(8 * 1024 * 1024) }), Abort = new AbortController(), Pending = F.Store.blob_part_async(Another, 0, Abort.signal);
		Abort.abort(); await assert.rejects(Pending, { name: "AbortError" }); await F.Store.close(); assert.equal(F.Store.blob_reader_stats().OpenHandles, 0); assert.equal(F.Store.blob_reader_stats().ActiveReads, 0);
	}
	finally { await F.close(); }
});

test("T08 client rejects changing file version, declared sizes and short last parts before publishing history", async () =>
{
	const F = fixture();
	try
	{
		const Id = F.Store.store_value({ Text: "x".repeat(100_000) });
		for(const Mode of ["version", "bytes", "short"])
		{
			const Client = new DeltaSyncClient(async Path =>
			{
				const U = new URL(Path, "http://original.test"), I = Number(U.searchParams.get("index")), Part = await F.Store.blob_part_async(Id, I);
				if(I) { if(Mode === "version") { Part.version = "f".repeat(64); } else if(Mode === "bytes") { Part.bytes++; } else { Part.data = Buffer.from(Part.data, "base64").subarray(1).toString("base64"); } } return Part;
			}, F.Store.Scope);
			await assert.rejects((Client as any).read_blob(Id), /版本|大小|short read|长度/); assert.equal(Client.cache_stats().Entries, 0);
		}
	}
	finally { await F.close(); }
});

test("T08 the real HTTP bridge answers status while a cold blob integrity scan is pending", async () =>
{
	const Root = mkdtempSync(join(tmpdir(), "codex-owned-range-http-")), Token = "original-range-token-".repeat(3), Client = "original-http-client";
	const Bridge = new RemoteBridge({ Port: 0, Cli: "mock", Cwd: Root, Vault: "original-fixture", ObsidianCli: "mock", StateDir: Root, Clients: [{ Id: Client, Hash: token_hash(Token) }] }, () => { throw Error("HTTP storage test must not start inference or an Agent"); });
	try
	{
		const Port = await Bridge.listen(), Get = async (Path: string) => { const R = await fetch(`http://127.0.0.1:${Port}${Path}`, { headers: { Authorization: "Bearer " + Token } }); assert.equal(R.status, 200); return R.json(); };
		await Get("/sync/catalog?offset=0"); const Store: SyncServerStore = (Bridge as any).Agents.get(Client).Store;
		const Id = Store.store_value({ Text: "x".repeat(32 * 1024 * 1024) }); let Release!: () => void, Started!: () => void, Finished = false;
		const Begun = new Promise<void>(R => { Started = R; }), Hold = new Promise<void>(R => { Release = R; }), Scan = (Store as any).scan_reader_async.bind(Store);
		(Store as any).scan_reader_async = async (R: any) => { Started(); await Hold; return Scan(R); };
		const Blob = Get(`/sync/blob?id=${Id}&index=0`).then(R => { Finished = true; return R; }); await Begun;
		const Status: any = await Get("/operations?offset=0"); assert.equal(Finished, false); assert.deepEqual(Status.operations, []); Release(); await Blob;
	}
	finally { await Bridge.close(); rmSync(Root, { recursive: true, force: true }); }
});
