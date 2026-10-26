// Real browser IndexedDB, original text only, fresh profile and owned hidden process.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import assert from "node:assert/strict";

const Browser = process.env.CODEX_LAYOUT_BROWSER;
if(!Browser) { throw new Error("Set CODEX_LAYOUT_BROWSER"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-edit-storage-"));
await build({ entryPoints: ["scripts/fixtures/edit-storage.ts"], bundle: true, platform: "browser", format: "iife", globalName: "StorageProbe", outfile: join(Directory, "storage.js") });
writeFileSync(join(Directory, "fixture.html"), '<!doctype html><meta charset="utf-8"><title>Original storage fixture</title><script src="storage.js"></script>');
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let Index = 0; Index < 80; Index++) { try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(Resolve => setTimeout(Resolve, 100)); } }
	assert.ok(Port);
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page => Page.type === "page").webSocketDebuggerUrl);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event => { const Data = JSON.parse(Event.data); if(Data.id) { const Pair = Pending.get(Data.id); if(Pair) { Pending.delete(Data.id); Data.error ? Pair.reject(Data.error) : Pair.resolve(Data.result); } } };
	function call(Method, Params = {}) { return new Promise((Resolve, Reject) => { const Id = ++Sequence; Pending.set(Id, { resolve: Resolve, reject: Reject }); Socket.send(JSON.stringify({ id: Id, method: Method, params: Params })); }); }
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href });
	await new Promise(Resolve => setTimeout(Resolve, 300));
	const First = await call("Runtime.evaluate", { expression: "StorageProbe.run_storage_case()", awaitPromise: true, returnByValue: true });
	assert.ok(!First.exceptionDetails, JSON.stringify(First.exceptionDetails));
	await call("Page.reload"); await new Promise(Resolve => setTimeout(Resolve, 300));
	const Reopened = await call("Runtime.evaluate", { expression: "StorageProbe.reopen_storage_case()", awaitPromise: true, returnByValue: true });
	assert.ok(!Reopened.exceptionDetails, JSON.stringify(Reopened.exceptionDetails));
	const Report = { tier: "real browser IndexedDB and reload; original fixture, not iPad or model acceptance", initial: First.result.value, reopened: Reopened.result.value };
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
}
finally { Socket?.close(); Child.kill(); }
