// Browser DOM and real source callbacks; Obsidian workspace navigation is observed by a fixture.
import { build } from "esbuild";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const Browser = process.env.CODEX_LAYOUT_BROWSER, Css = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !Css) { throw Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-r06-pdf-sources-"));
await build({ stdin: { contents: 'export { source_reference, answer_sources, render_sources } from "./src/sources"; export { combine_pdf_image } from "./src/composer-material"; export { pdf_hash } from "./src/pdf/types";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "iife", globalName: "Sources", outfile: join(Directory, "sources.js") });
const Fixture = readFileSync("scripts/fixtures/stream-render.js", "utf8");
const Case = `
window.source_case = async Width => {
	const Root = document.body.createDiv({cls:'codex-sidebar'}); Root.style.cssText='width:'+Width+'px;padding:12px;box-sizing:border-box';
	Root.createEl('h3',{text:'原创条件的回答来源'});
	Root.createEl('p',{text:'文字选区和两张补充图像分别回跳。'});
	const Bytes=new TextEncoder().encode('original R06 synthetic PDF version').buffer, Path='原创材料/条件.pdf', Calls=[];
	const Text={Path,Mode:'阅读',Kind:'选区',Mapping:'PDF文本层',CapturedAt:'original-text-time',Text:'',SelectedText:'设 a > 0',Heading:'PDF 第 3 页文字选区',LineStart:null,LineEnd:null,Truncated:false,Version:await Sources.pdf_hash(Bytes),PdfTarget:{Kind:'text',Page:3,Values:[0,0,0,7]}};
	const Region={X:0.1,Y:0.2,Width:0.4,Height:0.3,PageWidth:1000,PageHeight:1000,Scale:1,Rotation:90};
	const Crop={...Text,Pdf:{schemaVersion:2,ReadOnly:true,PageCount:4,Pages:[{Number:3,TextLayer:false,Kind:'region',Region,Image:{Id:'a'.repeat(64),Width:400,Height:300,Bytes:100}}]}};
	const Page={...Text,Pdf:{schemaVersion:1,ReadOnly:true,PageCount:4,Pages:[{Number:3,TextLayer:false,Image:{Id:'b'.repeat(64),Width:1000,Height:1000,Bytes:100}}]}};
	const Context=Sources.combine_pdf_image(Sources.combine_pdf_image(Text,Crop),Page);
	const User={Id:'question',Role:'user',TurnId:'turn',Context,Sources:Sources.source_reference(Context)}, Answer={Id:'answer',Role:'assistant',TurnId:'turn'};
	const Saved=JSON.parse(JSON.stringify([User,Answer])), Refs=Sources.answer_sources(Saved,Saved[1]);
	const App={vault:{getFileByPath:P=>P===Path?{path:P,stat:{size:Bytes.byteLength}}:null,readBinary:async()=>Bytes},workspace:{openLinkText:async(Link,From,NewLeaf)=>Calls.push({Link,From,NewLeaf})}};
	Sources.render_sources(App,Root,Refs); Root.querySelector('details').open=true;
	const Buttons=[...Root.querySelectorAll('button')], Labels=Buttons.map(B=>B.textContent);
	for(const Button of Buttons){Button.click();for(let I=0;I<100&&Button.disabled;I++)await new Promise(R=>setTimeout(R,2));if(Button.disabled)throw Error('source button did not complete');}
	const Fit=Root.scrollWidth<=Root.clientWidth+1&&Buttons.every(B=>B.getBoundingClientRect().right<=Width);
	return {Width,SourceCount:Refs.length,Labels,Calls,Fit};
};`;
writeFileSync(join(Directory, "fixture.html"), `<!doctype html><meta charset="utf-8"><style>${readFileSync(Css, "utf8")}${readFileSync("styles.css", "utf8")}</style><body class="theme-dark"><script>${Fixture}</script><script src="sources.js"></script><script>${Case}</script>`);
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let I = 0; I < 100; I++) { try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(R => setTimeout(R, 100)); } }
	assert.ok(Port);
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page => Page.type === "page").webSocketDebuggerUrl);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event => { const Data = JSON.parse(Event.data), P = Pending.get(Data.id); if(P) { Pending.delete(Data.id); Data.error ? P.reject(Data.error) : P.resolve(Data.result); } };
	function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++Sequence; Pending.set(id, { resolve, reject }); Socket.send(JSON.stringify({ id, method, params })); }); }
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href });
	await new Promise(Resolve => setTimeout(Resolve, 300));
	const Report = [];
	for(const Width of [320, 420])
	{
		await call("Emulation.setDeviceMetricsOverride", { width: Width, height: 720, deviceScaleFactor: 1, mobile: false });
		const Result = await call("Runtime.evaluate", { expression: `document.body.replaceChildren();document.body.className='${Width === 320 ? "theme-light" : "theme-dark"}';source_case(${Width})`, awaitPromise: true, returnByValue: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
		const Row = Result.result.value; Report.push(Row);
		assert.equal(Row.SourceCount, 3); assert.ok(Row.Fit); assert.match(Row.Labels[0], /原文字选区/);
		assert.ok(Row.Labels.slice(1).every(Label => Label.includes("补充图像") && !Label.includes("原选区")));
		assert.deepEqual(Row.Calls.map(Call => Call.Link), ["原创材料/条件.pdf#page=3&selection=0,0,0,7", "原创材料/条件.pdf#page=3", "原创材料/条件.pdf#page=3"]);
		assert.ok(Row.Calls.every(Call => Call.From === "" && Call.NewLeaf === true));
		const Shot = await call("Page.captureScreenshot", { format: "png" });
		writeFileSync(join(Directory, `sources-${Width}.png`), Buffer.from(Shot.data, "base64"));
	}
	writeFileSync(join(Directory, "report.json"), JSON.stringify({ Tier: "browser DOM, real source module, fixture Obsidian workspace; not native PDF/iPad", Report }, null, 2));
	console.log(JSON.stringify({ Directory, Report }));
}
finally { Socket?.close(); Child.kill(); }
