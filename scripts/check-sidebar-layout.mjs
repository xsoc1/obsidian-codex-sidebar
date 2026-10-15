// Opt-in Chromium layout fixture. Uses a fresh profile and never opens a window.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { build } from "esbuild";

const Browser = process.env.CODEX_LAYOUT_BROWSER;
const AppCss = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !AppCss) { throw new Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS (public Obsidian app.css)"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-sidebar-layout-"));
await build({ stdin: { contents: 'export * from "./src/sidebar-layout"; export { EditOptions } from "./src/edit/options";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "iife", globalName: "Layout", outfile: join(Directory, "layout.js") });
const Baseline = execFileSync("git", ["show", "665d76f:styles.css"], { encoding: "utf8" });
const Styles = readFileSync("styles.css", "utf8");
writeFileSync(join(Directory, "fixture.html"), `<!doctype html><html><meta charset="utf-8"><style>${readFileSync(AppCss, "utf8")}</style><style id="plugin"></style><body class="is-mobile is-tablet theme-dark"><div id="root" class="codex-sidebar" style="position:fixed;top:0;left:0;width:450px;height:519px"></div><script src="layout.js"></script><script>
function el(parent,tag,cls,text){const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;parent.appendChild(e);return e;}
HTMLElement.prototype.createEl=function(tag,o={}){const e=el(this,tag,o.cls,o.text);if(o.value!==undefined)e.value=o.value;Object.entries(o.attr||{}).forEach(([k,v])=>e.setAttribute(k,v));return e;};
HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o);};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o);};HTMLElement.prototype.setText=function(t){this.textContent=t;};
function render(folded,css,height,width)
{
	document.getElementById('plugin').textContent=css;
	const r=document.getElementById('root');
	r.replaceChildren();r.style.height=height+'px';r.style.width=width+'px';
	const nav=Layout.sidebar_panel(r,'codex-navigation','会话与连接 · 微型李代数讲义',folded);
	const h=el(nav.Body,'div','codex-header');
	el(h,'strong','','Codex');el(h,'button','','新会话');el(h,'button','','重连');
	el(el(nav.Body,'select','codex-sessions'),'option','','微型李代数讲义');
	el(r,'div','codex-status','回复完成 | math-writing 就绪');
	const c=Layout.sidebar_panel(r,'codex-context-tools','上下文与学习',true);
	const a=el(c.Body,'div','codex-context-actions');
	['捕获当前位置','解释选区','检查证明'].forEach(t=>el(a,'button','',t));
	el(c.Body,'div','codex-context','选区: 交换子的定义');
	const study=el(c.Body,'details','codex-study-container');el(study,'summary','','数学学习工作台');
	const m=el(r,'div','codex-messages');
	for(let i=0;i<4;i++)
	{
		const card=el(m,'div','codex-message codex-assistant');
		el(card,'div','codex-message-label','Codex');
		el(card,'div','codex-message-body','先看矩阵单位的乘法, 再计算交换子。定义与第一次完整运算留在正文中。');
	}
	const p=el(r,'div','codex-composer');
	const o=Layout.sidebar_panel(p,'codex-options','模型与选项 · gpt-6.1-sol / xhigh',true);
	const controls=el(o.Body,'div','codex-controls');
	['模型','思考档次'].forEach(t=>{const l=el(controls,'label','',t);el(el(l,'select'),'option','',t==='模型'?'gpt-6.1-sol':'xhigh');});
	const toggles=el(o.Body,'div','codex-run-toggles');
	['Fast','上下文占用','行内补全'].forEach(t=>{const l=el(toggles,'label');const input=el(l,'input');input.type='checkbox';el(l,'span','',t);});
	el(o.Body,'div','codex-usage','上下文 ~28%');
	const send=Layout.sidebar_panel(p,'codex-send-tools','提问与发送',folded);
	el(send.Body,'textarea').placeholder='随时提问...';
	if(css===styles)window.editOptions=new Layout.EditOptions(send.Body,()=>{});
	const actions=el(send.Body,'div','codex-compose-actions');
	el(actions,'button','','发送');el(actions,'button','','停止');
	return {messageHeight:m.getBoundingClientRect().height,rootHeight:r.clientHeight,scrollHeight:r.scrollHeight,composerHeight:p.getBoundingClientRect().height};
}
window.styles=${JSON.stringify(Styles)};window.baseline=${JSON.stringify(Baseline)};</script></body></html>`);
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let Index = 0; Index < 80; Index++)
	{
		try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(Resolve => setTimeout(Resolve, 100)); }
	}
	assert.ok(Port, "Headless browser did not start");
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page => Page.type === "page").webSocketDebuggerUrl);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event => { const Data = JSON.parse(Event.data); if(Data.id) { const Pair = Pending.get(Data.id); if(Pair) { Pending.delete(Data.id); Data.error ? Pair.reject(Data.error) : Pair.resolve(Data.result); } } };
	function call(Method, Params = {}) { return new Promise((Resolve, Reject) => { const Id = ++Sequence; Pending.set(Id, { resolve: Resolve, reject: Reject }); Socket.send(JSON.stringify({ id: Id, method: Method, params: Params })); }); }
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href });
	await new Promise(Resolve => setTimeout(Resolve, 400));
	const Rows = [];
	for(const Theme of ["theme-dark", "theme-light"])
	for(const [Width, Height] of [[450,519],[350,720],[320,620],[450,340]])
	{
		await call("Emulation.setDeviceMetricsOverride", { width: Math.max(Width,512), height: Height + 180, deviceScaleFactor: 1, mobile: false });
		const Result = await call("Runtime.evaluate", { expression: `(()=>{
			document.body.className='is-mobile is-tablet ${Theme}';
			const before=render(false,baseline,${Height},${Width});
			const after=render(true,styles,${Height},${Width});
			const root=document.getElementById('root');
			const navigation=root.querySelector('.codex-navigation');
			const options=root.querySelector('.codex-options');
			const compose=root.querySelector('.codex-send-tools');
			const defaultFolded=!navigation.open&&!compose.open;
			const input=compose.querySelector('textarea');
			const initiallyHidden=!input.checkVisibility();
			compose.querySelector('summary').click();
			input.value='中文草稿 $[X,Y]$';input.setSelectionRange(2,4);
			compose.querySelector('summary').click();
			Layout.reveal_sidebar_panel({Details:compose});input.focus();
			const draftPreserved=input===compose.querySelector('textarea')&&input.value==='中文草稿 $[X,Y]$'&&input.selectionStart===2&&input.selectionEnd===4;
			const edit=root.querySelector('.codex-edit-options');const editFolded=!edit.open;
			edit.open=true;editOptions.Mode.value='edit';editOptions.refresh('修正本段',false,'Original.md');edit.open=false;edit.open=true;
			const editPreserved=editOptions.Mode.value==='edit'&&[...edit.querySelectorAll('select')].every(s=>s.labels.length===1);editOptions.Mode.value='auto';editOptions.refresh('',false);edit.open=false;
			const focusRestored=document.activeElement===input;
			options.open=true;const select=options.querySelector('select');select.value='gpt-6.1-sol';options.open=false;
			navigation.querySelector('summary').click();const session=navigation.querySelector('select');const selectedSession=session.value;navigation.querySelector('summary').click();
			root.scrollTop=root.scrollHeight;
			const send=[...root.querySelectorAll('button')].find(e=>e.textContent==='发送');
			const rect=send.getBoundingClientRect(),bounds=root.getBoundingClientRect();
			return {theme:'${Theme}',width:${Width},height:${Height},before,after,defaultFolded,initiallyHidden,draftPreserved,editFolded,editPreserved,focusRestored,sendReachable:rect.bottom<=bounds.bottom&&rect.top>=bounds.top,preserved:select.value==='gpt-6.1-sol'&&session.value===selectedSession,contextClosed:!root.querySelector('.codex-context-tools').open,optionsClosed:!options.open,navigationClosed:!navigation.open,overflow:root.scrollWidth>root.clientWidth,hover:root.querySelectorAll('[title],[aria-label]').length};
		})()`, returnByValue: true });
		assert.ok(!Result.exceptionDetails, "Fixture evaluation failed");
		const Row = Result.result.value; Rows.push(Row);
		assert.ok(Row.after.messageHeight > Row.before.messageHeight + (Height > 400 ? 70 : 0), "Controls still squeeze the answer area");
		assert.ok(Row.defaultFolded && Row.initiallyHidden && Row.draftPreserved && Row.editFolded && Row.editPreserved && Row.focusRestored && Row.sendReachable && Row.preserved && Row.contextClosed && Row.optionsClosed && Row.navigationClosed && !Row.overflow && !Row.hover, JSON.stringify(Row));
	}
	await call("Runtime.evaluate", { expression: "render(true,styles,519,450)" });
	const Shot = await call("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(Directory, "after.png"), Buffer.from(Shot.data, "base64"));
	writeFileSync(join(Directory, "report.json"), JSON.stringify({ tier: "headless CSS fixture, not iPad device acceptance", rows: Rows }, null, 2));
	console.log(JSON.stringify({ directory: Directory, rows: Rows }, null, 2));
}
finally { Socket?.close(); Child.kill(); }
