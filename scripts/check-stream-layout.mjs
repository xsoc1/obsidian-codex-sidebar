// Actual CodexView render path, with an asynchronous SDK renderer and original text.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { build } from "esbuild";

const Browser = process.env.CODEX_LAYOUT_BROWSER, AppCss = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !AppCss) { throw new Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-stream-layout-"));
await build({ stdin: { contents: readFileSync("src/main.ts", "utf8") + "\nexport { CodexView };", resolveDir: join(process.cwd(), "src"), loader: "ts" }, external: ["obsidian", "@codemirror/state", "@codemirror/view", "node:*"], bundle: true, platform: "browser", format: "iife", globalName: "Sidebar", outfile: join(Directory, "sidebar.js") });
writeFileSync(join(Directory, "fixture.html"), '<!doctype html><meta charset="utf-8"><style>' + readFileSync(AppCss, "utf8") + readFileSync("styles.css", "utf8") + '</style><body class="theme-dark"><script>' + readFileSync("scripts/fixtures/stream-render.js", "utf8") + '</script><script src="sidebar.js"></script>');
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let Index = 0; Index < 80; Index++)
	{
		try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(Resolve => setTimeout(Resolve, 100)); }
	}
	assert.ok(Port);
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page => Page.type === "page").webSocketDebuggerUrl);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event => { const Data = JSON.parse(Event.data); if(Data.id) { const Pair = Pending.get(Data.id); if(Pair) { Pending.delete(Data.id); Data.error ? Pair.reject(Data.error) : Pair.resolve(Data.result); } } };
	function call(Method, Params = {}) { return new Promise((Resolve, Reject) => { const Id = ++Sequence; Pending.set(Id, { resolve: Resolve, reject: Reject }); Socket.send(JSON.stringify({ id: Id, method: Method, params: Params })); }); }
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href });
	await new Promise(Resolve => setTimeout(Resolve, 300));
	const Result = await call("Runtime.evaluate", { expression: "(async()=>{const surfaces=[];for(const theme of ['theme-dark','theme-light'])for(const mobile of [false,true]){document.body.className=theme+(mobile?' is-mobile is-tablet':'');surfaces.push({theme,mobile,cases:[await run_stream_case(1),await run_stream_case(3),await run_stream_case(1,true),await run_stream_case(3,true),await run_stream_case(1,'near'),await run_stream_case(3,'near')],context:await run_context_case(),sidebar:await run_simplified_sidebar_case()});}return {surfaces};})()", awaitPromise: true, returnByValue: true });
	assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
	const Report = Result.result.value;
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2));
	console.log(JSON.stringify({ directory: Directory, tier: "actual CodexView + asynchronous SDK fixture, not native model/device acceptance", ...Report }));
	for(const Surface of Report.surfaces)
	{
		for(const Row of Surface.cases)
		{
			assert.ok(Row.minimumHeight >= Row.beforeHeight - 1, "Streaming temporarily collapses the visible transcript");
			assert.ok(Row.historyPreserved && Row.selectionPreserved && Row.renderCalls === 1, "Streaming replaces or reparses unchanged history");
			assert.ok(Row.readingPreserved && Row.lateLayoutPreserved, "Scrolling or late layout overrides the reading position");
		}
		assert.ok(Object.values(Surface.context).every(Boolean), "Unchanged source preview is rebuilt or its checkbox is stale");
		assert.ok(Object.values(Surface.sidebar).every(Boolean), "Actual sidebar retained removed controls or ignored the saved edit range");
	}
	for(const Width of [320, 420, 540])
	{
		await call("Emulation.setDeviceMetricsOverride", { width: Width, height: 720, deviceScaleFactor: 1, mobile: false });
		const Result = await call("Runtime.evaluate", { expression: `document.body.className='theme-dark';run_simplified_sidebar_case(true,${Width})`, awaitPromise: true, returnByValue: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
		if(Width === 420)
		{
			await call("Runtime.evaluate", { expression: `(()=>{
				const root=document.getElementById('simplified-sidebar-fixture');
				for(const cls of ['codex-navigation','codex-context-tools'])root.querySelector('.'+cls).open=false;
				root.querySelector('.codex-options>summary').textContent='模型与选项 · gpt-6.1-sol / xhigh';
				root.querySelector('textarea').value='可以再解释一下这一步吗？';
				const body=root.querySelector('.codex-message-body');body.replaceChildren();
				body.createEl('h3',{text:'从矩阵乘法理解交换子'});
				body.createEl('p',{text:'固定矩阵 X 后，交换子为 [X,Y] = XY − YX。把加法与数乘分别代入，就能验证它关于 Y 的线性。'});
				body.createEl('p',{text:'例如，先计算两个矩阵单位的乘积：'});
				const math=body.createDiv({cls:'math-block',text:'E₁₂E₂₁ = E₁₁， E₂₁E₁₂ = E₂₂'});math.style.cssText='text-align:center;padding:14px 0;font-family:serif';
				body.createEl('p',{text:'因此 [E₁₂,E₂₁] = E₁₁ − E₂₂。这个例子也说明，交换子通常不为零。'});
				body.createEl('blockquote',{text:'先完成一次具体计算，再回到一般性质，公式之间的联系就更清楚。'});
			})()` });
		}
		const Shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: 720, scale: 1 } });
		writeFileSync(join(Directory, `simplified-sidebar-${Width}.png`), Buffer.from(Shot.data, "base64"));
		if(Width === 420) { writeFileSync(join(Directory, "sidebar-glass.png"), Buffer.from(Shot.data, "base64")); }
		await call("Runtime.evaluate", { expression: "document.getElementById('simplified-sidebar-fixture').remove()" });
	}
}
finally { Socket?.close(); Child.kill(); }
