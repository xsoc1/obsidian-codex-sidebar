import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const Browser = process.env.CODEX_LAYOUT_BROWSER;
if(!Browser) { throw new Error("Set CODEX_LAYOUT_BROWSER to a Chromium executable"); }
const Dir = mkdtempSync(join(tmpdir(), "codex-pdf-box-"));
await build({ entryPoints: ["src/pdf/box.ts"], bundle: true, platform: "browser", format: "iife", globalName: "Box", outfile: join(Dir, "box.js") });
writeFileSync(join(Dir, "test.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${readFileSync("styles.css", "utf8")}
body{margin:0;font:15px system-ui;--size-4-1:4px;--size-4-2:8px;--radius-m:8px;--text-normal:#27263b;--background-primary:#fff;--interactive-accent:#7257d9;--shadow-s:0 2px 10px #2224}
main{position:relative;width:100vw;height:100vh;background:#e9e6ec}.pdf-viewer-container{position:absolute;inset:0;overflow:auto}
.page{box-sizing:content-box;border:4px solid #dfdce3;width:250px;height:400px;margin:35px auto 12px;background:#fff}
.canvasWrapper{box-sizing:border-box;width:100%;height:100%;padding:46px 24px;color:#29253d}
.canvasWrapper div{border:1px solid #bdb8cf;padding:10px;margin-top:12px}
</style>
<main id="root"><div class="pdf-viewer-container"><div class="page" data-page-number="1"><div class="canvasWrapper"><b>原创 PDF 测试页</b><div>定义 1 · 设 X, Y 为矩阵<br><br>[X,Y] = XY − YX</div></div></div><div class="page" data-page-number="2"><div class="canvasWrapper">第二页</div></div></div></main>
<script src="box.js"></script><script>
const root=document.querySelector('#root'), scroller=root.querySelector('.pdf-viewer-container'), pages=[...root.querySelectorAll('.page')];
const nativePages=pages.map(div=>({div,viewport:{width:250,height:400,rotation:0,convertToPdfPoint:(x,y)=>[x,400-y]}}));
const file={path:'fixture.pdf'}, view={containerEl:root,file,viewer:{child:{file,pdfViewer:{pdfViewer:{getPageView:i=>nativePages[i]}}}}};
let results=[], ordinary=0; scroller.addEventListener('pointerdown',()=>ordinary++);
const origin=()=>{const b=pages[0].querySelector('.canvasWrapper').getBoundingClientRect();return {x:b.left,y:b.top};};
const arm=()=>{const c=new AbortController(); Box.select_pdf_box(view,c.signal,()=>c.abort(),x=>results.push(x));return origin();};
</script>`);
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Dir, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let I = 0; I < 100; I++)
	{
		try { Port = Number(readFileSync(join(Dir, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; }
		catch { await new Promise(Resolve => setTimeout(Resolve, 100)); }
	}
	assert.ok(Port, "Chromium debugger was unavailable");
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page => Page.type === "page").webSocketDebuggerUrl);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event =>
	{
		const Data = JSON.parse(Event.data), Wait = Pending.get(Data.id);
		if(Wait) { Pending.delete(Data.id); Data.error ? Wait.Reject(Data.error) : Wait.Resolve(Data.result); }
	};
	const call = (method, params = {}) => new Promise((Resolve, Reject) =>
	{
		const id = ++Sequence; Pending.set(id, { Resolve, Reject }); Socket.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async expression =>
	{
		const R = await call("Runtime.evaluate", { expression, returnByValue: true });
		assert.ok(!R.exceptionDetails, JSON.stringify(R.exceptionDetails));
		return R.result.value;
	};
	const Mouse = (type, X, Y) => call("Input.dispatchMouseEvent", { type, x: X, y: Y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
	const metrics = (width, mobile) => call("Emulation.setDeviceMetricsOverride", { width, height: 640, deviceScaleFactor: 1, mobile });
	await metrics(600, false);
	await call("Page.navigate", { url: pathToFileURL(join(Dir, "test.html")).href });
	await new Promise(Resolve => setTimeout(Resolve, 350));
	let P = await evaluate("origin()");
	await Mouse("mousePressed", P.x + 30, P.y + 80); await Mouse("mouseReleased", P.x + 30, P.y + 80);
	assert.equal(await evaluate("ordinary"), 1);
	P = await evaluate("arm()");
	await Mouse("mousePressed", P.x + 35, P.y + 85); await Mouse("mouseReleased", P.x + 37, P.y + 88);
	assert.match(await evaluate("document.querySelector('[role=status]').textContent"), /太小/);
	await Mouse("mousePressed", P.x + 30, P.y + 80); await Mouse("mouseReleased", P.x + 30, P.y + 460);
	assert.match(await evaluate("document.querySelector('[role=status]').textContent"), /同一张/);
	await Mouse("mousePressed", P.x + 30, P.y + 80); await evaluate("scroller.scrollTop = 20");
	await Mouse("mouseReleased", P.x + 150, P.y + 120);
	assert.match(await evaluate("document.querySelector('[role=status]').textContent"), /缩放已变化/);
	P = await evaluate("scroller.scrollTop=0;origin()");
	await Mouse("mousePressed", P.x + 190, P.y + 158); await Mouse("mouseMoved", P.x + 29, P.y + 70);
	assert.equal(await evaluate("document.querySelector('.codex-pdf-box-outline').hidden"), false);
	writeFileSync(join(Dir, "desktop-drag.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
	await Mouse("mouseReleased", P.x + 29, P.y + 70);
	assert.deepEqual(await evaluate("results"), [{ Target: { Page: 1, Kind: "rect", Values: [29, 242, 190, 330] }, Rotation: 0 }]);
	assert.equal(await evaluate("!!document.querySelector('.codex-pdf-box')"), false);
	await evaluate("arm()");
	await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
	assert.equal(await evaluate("!!document.querySelector('.codex-pdf-box')"), false);
	await metrics(320, true);
	await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
	P = await evaluate("arm()");
	assert.ok(await evaluate("(()=>{const b=document.querySelector('.codex-pdf-box-bar').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth})()"));
	const Touch = (type, X, Y) => call("Input.dispatchTouchEvent", { type, touchPoints: X === undefined ? [] : [{ x: X, y: Y, id: 1 }] });
	await Touch("touchStart", P.x + 32, P.y + 70); await Touch("touchMove", P.x + 182, P.y + 155); await Touch("touchCancel");
	assert.equal(await evaluate("results.length"), 1);
	await Touch("touchStart", P.x + 32, P.y + 70); await Touch("touchMove", P.x + 182, P.y + 155);
	writeFileSync(join(Dir, "touch-drag.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
	await Touch("touchEnd");
	assert.deepEqual((await evaluate("results")).at(-1), { Target: { Page: 1, Kind: "rect", Values: [32, 245, 182, 330] }, Rotation: 0 });
	assert.equal(await evaluate("!!document.querySelector('.codex-pdf-box')"), false);
	console.log(JSON.stringify({ directory: Dir, mouse: true, touch: true, cancellation: true, pageBoundsAndScroll: true, mobileWidth: 320, tier: "Chromium input with native-shaped fixture, no PDF++" }));
}
finally { Socket?.close(); Child.kill(); }
