import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { DeltaSyncClient } from "../src/sync/client";
import { SyncServerStore } from "../src/sync/server-store";
import { create_send_operation } from "../src/sync/operations";
import { canonical_json } from "../src/sync/types";

// Exact baseline client and its source dependencies; no checkout/reset or daily data access.
async function baseline(Ref: string)
{
	if(!/^[0-9a-f]{40}$/.test(Ref)) { throw Error("baseline must be an exact Git commit"); }
	const Root = resolve(__dirname, ".."), Output = await build({ entryPoints: [join(Root, "src/sync/client.ts")], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "baseline-source", setup(B)
	{
		B.onLoad({ filter: /\.ts$/ }, Args =>
		{
			const Path = relative(Root, Args.path).split(sep).join("/"); if(!Path.startsWith("src/")) { return; }
			return { contents: execFileSync("git", ["show", Ref + ":" + Path], { cwd: Root, encoding: "utf8" }), loader: "ts", resolveDir: dirname(Args.path) };
		});
	} }] });
	return (await import("data:text/javascript;base64," + Buffer.from(Output.outputFiles[0].text).toString("base64"))).DeltaSyncClient;
}

async function main()
{
const Ref = process.argv[2] ?? "4cc440be3e77dcd16d893ff6d9d7bcf1eee90b6a", Before = await baseline(Ref), Results: any[] = [];
for(const Count of [16, 64, 128])
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-sync-cost-original-"));
	try
	{
		const Store = new SyncServerStore(Directory, "original-cost"), State = { Settings: { Model: "original" }, ActiveId: "s0", Sessions: Array.from({ length: Count }, (_, I) => ({ Id: "s" + I, Title: "Original " + I, ThreadId: null, Messages: [{ Id: "a" + I, Role: "assistant", Text: "原创正文".repeat(10000) + I }] })) };
		Store.legacy_write(State);
		const Metas = await Promise.all(State.Sessions.map(async (S, I) => { const O = await create_send_operation(Store.Scope, S.Id, "q" + I, { Prompt: "Original evidence " + I + "x".repeat(32000) }, "op" + I); O.Status = "completed"; const { Input, ...Meta } = O; return { ...Meta, InputBlob: Store.store_value(Input) }; }));
		for(const [Label, Client] of [["before", Before], ["after", DeltaSyncClient]] as const)
		{
			let Requests = 0, ReadBytes = 0;
			const Http = async (Path: string) =>
			{
				Requests++; const U = new URL(Path, "http://original.test"), Offset = Number(U.searchParams.get("offset") ?? 0); let V: any;
				if(U.pathname === "/sync/catalog" || U.pathname === "/sync/history") { V = { ...Store.page(U.pathname.endsWith("catalog") ? "catalog" : "history", U.searchParams.has("revision") ? Number(U.searchParams.get("revision")) : null, Offset, U.searchParams.get("session") ?? undefined), cursor: 0 }; }
				else if(U.pathname === "/sync/blob") { V = Store.blob_part(U.searchParams.get("id")!, Number(U.searchParams.get("index"))); }
				else if(U.pathname === "/operations") { V = { operations: Metas.slice(Offset, Offset + 64), next: Offset + 64 < Metas.length ? Offset + 64 : null, snapshot: "fixed-original" }; }
				else { throw Error("unexpected path"); } ReadBytes += Buffer.byteLength(JSON.stringify(V)); return structuredClone(V);
			};
			const C = new Client(Http, Store.Scope), Local = { ...State, Sessions: [] };
			for(const Phase of ["cold", "same-client-warm"])
			{
				Requests = 0; ReadBytes = 0; const Start = performance.now(), Result = await C.restore(Local), Milliseconds = performance.now() - Start;
				assert.equal(Result.State.Sessions.find((S: any) => S.Id === "s0").Messages[0].Text, State.Sessions[0].Messages[0].Text);
				const Cache = C.cache_stats?.() ?? { Utf8Bytes: [...C.Blobs.values()].reduce((N: number, V: any) => N + Buffer.byteLength(canonical_json(V)), 0), LimitUtf8Bytes: null };
				Results.push({ Sessions: Count, Implementation: Label, Phase, Requests, ResponseUtf8Bytes: ReadBytes, Milliseconds: Math.round(Milliseconds * 10) / 10, HydratedMessages: Result.State.Sessions.reduce((N: number, S: any) => N + S.Messages.length, 0), Cache });
			}
		}
	}
	finally { assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); }
}
console.log(JSON.stringify({ SchemaVersion: 1, Fixture: "original; real temporary disk; in-process HTTP adapter; no network/device/inference", Baseline: Ref, Node: process.version, Results }, null, 2));
}
void main().catch(E => { console.error(E); process.exitCode = 1; });
