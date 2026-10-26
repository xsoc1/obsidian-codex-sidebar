// Actual CodexView + original asynchronous SDK fixture; not native MathJax or iPad.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { build } from "esbuild";

const Browser = process.env.CODEX_LAYOUT_BROWSER, AppCss = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !AppCss) { throw Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-cold-history-")), Old = P => execFileSync("git", ["show", "1.1.0:" + P], { encoding: "utf8" });
for(const Baseline of [false, true])
{
	await build({ stdin: { contents: (Baseline ? Old("src/main.ts") : readFileSync("src/main.ts", "utf8")) + "\nexport { CodexView };", resolveDir: join(process.cwd(), "src"), loader: "ts" }, plugins: Baseline ? [{ name: "immutable-list-baseline", setup(B) { B.onLoad({ filter: /[\\/]src[\\/]message-list\.ts$/ }, () => ({ contents: Old("src/message-list.ts"), loader: "ts" })); } }] : [], external: ["obsidian", "@codemirror/state", "@codemirror/view", "node:*"], bundle: true, platform: "browser", format: "iife", globalName: Baseline ? "BaselineSidebar" : "CandidateSidebar", outfile: join(Directory, Baseline ? "baseline.js" : "candidate.js") });
}
writeFileSync(join(Directory, "fixture.html"), '<!doctype html><meta charset="utf-8"><style>' + readFileSync(AppCss, "utf8") + readFileSync("styles.css", "utf8") + '</style><script>' + readFileSync("scripts/fixtures/stream-render.js", "utf8") + '</script><script src="candidate.js"></script><script src="baseline.js"></script>');
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let I = 0; I < 80; I++) { try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(R => setTimeout(R, 100)); } }
	assert.ok(Port); const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json(); Socket = new WebSocket(Pages.find(P => P.type === "page").webSocketDebuggerUrl);
	await new Promise((R, J) => { Socket.onopen = R; Socket.onerror = J; }); let Sequence = 0; const Pending = new Map();
	Socket.onmessage = E => { const V = JSON.parse(E.data); if(V.id) { const P = Pending.get(V.id); if(P) { Pending.delete(V.id); V.error ? P.reject(V.error) : P.resolve(V.result); } } };
	const Call = (Method, Params = {}) => new Promise((resolve, reject) => { const id = ++Sequence; Pending.set(id, { resolve, reject }); Socket.send(JSON.stringify({ id, method: Method, params: Params })); });
	await Call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href }); await new Promise(R => setTimeout(R, 300));
	const Value = await Call("Runtime.evaluate", { expression: "(async()=>{const rows=[];for(const theme of ['theme-dark','theme-light'])for(const mobile of [false,true]){document.body.className=theme+(mobile?' is-mobile is-tablet':'');window.Sidebar=BaselineSidebar;const baseline=await run_cold_history_case();window.Sidebar=CandidateSidebar;const candidate=await run_cold_history_case();rows.push({theme,mobile,baseline,candidate});}return rows;})()", awaitPromise: true, returnByValue: true });
	assert.ok(!Value.exceptionDetails, JSON.stringify(Value.exceptionDetails)); const Rows = Value.result.value;
	for(const R of Rows)
	{
		assert.equal(R.baseline.first.cardRenders, 240); assert.equal(R.candidate.first.cardRenders, 40); assert.equal(R.candidate.first.cards, 40);
		assert.ok(R.candidate.focusStable && R.candidate.stableSourcePath && R.candidate.loadEarlierAvailable && R.candidate.earlierAdded && R.candidate.olderCardsRetained && R.candidate.savedMessagesEqual);
	}
	const Report = { tier: "original 240-message SDK fixture, first complete visible batch; not native MathJax, real model or iPad", cases: Rows };
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
}
finally { Socket?.close(); Child.kill(); }
