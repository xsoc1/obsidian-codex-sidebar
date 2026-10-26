// Actual CodexView and the 1.0.1 baseline, original messages, asynchronous SDK fixture.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { build } from "esbuild";
import assert from "node:assert/strict";

const Browser = process.env.CODEX_LAYOUT_BROWSER, AppCss = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !AppCss) { throw new Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-history-switch-"));
const Old = Path => execFileSync("git", ["show", "1.0.1:" + Path], { encoding: "utf8" });
for(const Baseline of [false, true])
{
	await build({ stdin: { contents: (Baseline ? Old("src/main.ts") : readFileSync("src/main.ts", "utf8")) + "\nexport { CodexView };", resolveDir: join(process.cwd(), "src"), loader: "ts" }, plugins: Baseline ? [{ name: "immutable-message-list-baseline", setup(Build) { Build.onLoad({ filter: /[\\/]src[\\/]message-list\.ts$/ }, () => ({ contents: Old("src/message-list.ts"), loader: "ts" })); } }] : [], external: ["obsidian", "@codemirror/state", "@codemirror/view", "node:*"], bundle: true, platform: "browser", format: "iife", globalName: Baseline ? "BaselineSidebar" : "Sidebar", outfile: join(Directory, Baseline ? "baseline.js" : "sidebar.js") });
}
writeFileSync(join(Directory, "fixture.html"), '<!doctype html><meta charset="utf-8"><style>' + readFileSync(AppCss, "utf8") + readFileSync("styles.css", "utf8") + '</style><script>' + readFileSync("scripts/fixtures/stream-render.js", "utf8") + '</script><script src="sidebar.js"></script><script>window.CandidateSidebar=Sidebar;</script><script src="baseline.js"></script>');
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
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href }); await new Promise(Resolve => setTimeout(Resolve, 300));
	const Result = await call("Runtime.evaluate", { expression: "(async()=>{const cases=[];for(const theme of ['theme-dark','theme-light'])for(const mobile of [false,true]){document.body.className=theme+(mobile?' is-mobile is-tablet':'');Sidebar=BaselineSidebar;const baseline=await run_switch_case();Sidebar=CandidateSidebar;const candidate=await run_switch_case(true);cases.push({theme,mobile,baseline,candidate});}return cases;})()", awaitPromise: true, returnByValue: true });
	assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
	const Cases = Result.result.value;
	for(const Row of Cases)
	{
		assert.equal(Row.baseline.returnRenderCalls, Row.baseline.historyCount, "Baseline must reproduce full-history rendering");
		assert.equal(Row.baseline.cardsReused, false);
		assert.equal(Row.candidate.returnRenderCalls, 0); assert.ok(Row.candidate.cardsReused && Row.candidate.readingPreserved);
		assert.ok(Row.candidate.sourcePathStable && Row.candidate.devicesIsolated && Row.candidate.desktopReturnsRetained);
	}
	const Report = { tier: "actual CodexView + asynchronous SDK fixture; not native MathJax, real model or iPad", cases: Cases };
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
}
finally { Socket?.close(); Child.kill(); }
