// Opt-in actual CodexView fixture. No Obsidian service, credentials or inference.
import { build } from "esbuild";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const Browser = process.env.CODEX_LAYOUT_BROWSER, Css = process.env.CODEX_LAYOUT_APP_CSS;
if(!Browser || !Css) { throw Error("Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-material-browser-"));
await build({ stdin: { contents: 'export { CodexView } from "./src/view"; export { context_window } from "./src/markdown-blocks"; export { answer_quote } from "./src/quote";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, external: ["obsidian"], platform: "browser", format: "iife", globalName: "Sidebar", outfile: join(Directory, "view.js") });
const Fixture = readFileSync("scripts/fixtures/stream-render.js", "utf8");
const Image = "data:image/jpeg;base64," + readFileSync("examples/pdf/scanned-page.jpg").toString("base64");
const Case = `
window.material_case = async Width => {
	const Root=document.body.createDiv(); Root.style.cssText='width:'+Width+'px;height:720px';Root.id='material-fixture';
	const Text='固定 X，沿原路线核对交换子 [X,Y] = XY − YX。', Calls=[], Scope='fixture-'+crypto.randomUUID();let Active='local',Reject=true,Continued=0;
	const User={Id:'original-question',Role:'user',Text:'说明线性'};
	const Answer={Id:'answer',Role:'assistant',Text,CompletionStatus:'partial',BackendResult:{Text,Status:'partial',Metadata:{Reason:'output-limit',Model:'fixture-actual-model',Transport:'streaming'}}};
	const Session={Id:'session',Title:'材料核对',Messages:[User,Answer]};
	const Owner={Session,State:{Sessions:[Session],Settings:{AttachContext:true,EditScope:'captured',Model:'fixture',Effort:'',ShowUsage:false,Completion:false}},Models:[],Inline:{get_suggestion:()=>null},Capture:{Snapshot:null,Pdf:{verify_snapshot:async()=>{}},clear(){this.Snapshot=null;}},PdfImages:{get:async()=>${JSON.stringify(Image)}},Busy:false,Status:'就绪',SkillStatus:'fixture',draft_scope:()=>Scope,persist:async()=>{},refresh(){},can_capture_pdf_box:()=>false,connection_choices:()=>[{Id:'local',Label:'本机 Codex',Active:Active==='local'},{Id:'api',Label:'示例 API 连接',Active:Active==='api'}],connection_label:()=>Active==='local'?'本机 Codex · 文字 / 图片':'示例 API · 受控响应',choose_connection:async Id=>{if(Reject)throw Error('fixture connection failed');Active=Id;},continue_answer:async()=>{Continued++;},send_chat:async(...Args)=>{Calls.push(Args);return false;},clear_context(){View.forget_attachment();this.Capture.clear();View.refresh();}};
	const View=new Sidebar.CodexView({},Owner);View.contentEl=Root;View.app={vault:{getName:()=>Scope}};Owner.refresh=()=>View.refresh();
	await View.onOpen();await View.render_messages();Root.querySelector('.codex-navigation').open=true;
	const Select=Root.querySelector('.codex-connection-picker select'), Label=document.getElementById(Select.getAttribute('aria-labelledby')), FirstOption=Select.firstChild;
	View.refresh();const StableOptions=Select.firstChild===FirstOption;
	Select.value='api';Select.dispatchEvent(new Event('change'));await new Promise(R=>setTimeout(R,10));const FailedPreserved=Select.value==='local';Reject=false;Select.value='api';Select.dispatchEvent(new Event('change'));await new Promise(R=>setTimeout(R,10));
	const ContinuedButton=[...Root.querySelectorAll('button')].find(B=>B.textContent==='继续这份回答');ContinuedButton.click();await Promise.resolve();
	const Quote=Owner.AnswerQuote=Sidebar.answer_quote('session','answer','[X,Y]',Text,'incomplete');
	const Snapshot={Path:'原创条件.pdf',Kind:'选区',Mode:'阅读',Mapping:'PDF文本层',CapturedAt:'fixture-original-time',SelectedText:'补充条件 a > 0',Text:'',LineStart:null,LineEnd:null,Heading:'第 3 页文字选区',Truncated:false,SelectedTruncated:false,ContextTruncated:false,Version:'original-version',PdfTarget:{Kind:'text',Page:3,Values:[0,0,0,5]},Pdf:{schemaVersion:1,ReadOnly:true,PageCount:5,Pages:[{Number:3,TextLayer:false,Image:{Id:'a'.repeat(64),Width:1224,Height:1584,Bytes:100}}]}};
	View.accept_attachment(Snapshot,Scope,'session');View.Input.value='沿原证明路线说明补充条件';View.Input.dispatchEvent(new Event('input'));Owner.Capture.Snapshot={...Snapshot,Path:'不得混入的自动捕获.pdf'};View.refresh();View.reveal_pdf_context();
	const Material=View.current_material(),Saved=View.DraftStore.load(),Popover=Root.querySelector('.codex-context-popover');
	const ExplicitOnly=Material.Context.Path==='原创条件.pdf'&&Material.Quote.MessageId==='answer'&&!Popover.textContent.includes('不得混入');
	const Source=[...Popover.querySelectorAll('details')].find(D=>D.querySelector(':scope>summary')?.textContent.startsWith('原创条件.pdf'));Source.open=true;const Picture=Source.querySelector('details');Picture.open=true;Picture.dispatchEvent(new Event('toggle'));await Promise.resolve();
	const TextKept=Popover.textContent.includes('补充条件 a > 0'),Supplement=[...Popover.querySelectorAll('button')].some(B=>B.textContent==='补充同页图像');
	await View.send_input('question');const SameSent=Calls.length===1&&Calls[0][1].Version===Saved.Context.Version&&Calls[0][2].MessageId===Saved.Quote.MessageId&&Calls[0][3].MaterialOrigin==='explicit';
	[...Popover.querySelectorAll('button')].find(B=>B.textContent==='移除补图').click();const TextOnly=View.current_material(),RemovalIndependent=!TextOnly.Context.Pdf&&TextOnly.Context.SelectedText===Snapshot.SelectedText&&TextOnly.Quote.MessageId==='answer';View.accept_attachment(Snapshot,Scope,'session');
	const Bounds=Popover.getBoundingClientRect(),Fit=Root.scrollWidth<=Root.clientWidth+1&&Bounds.width<=Width;
	const Output={StableOptions,FailedPreserved,ConnectionChanged:Select.value==='api',VisibleConnectionLabel:Label.textContent==='连接',ExplicitOnly,TextKept,Supplement,SameSent,RemovalIndependent,ContinueExplicit:Continued===1&&Answer.Text===Text,MissingUsage:Root.textContent.includes('用量: 服务商未提供'),Fit,NoHover:Root.querySelectorAll('[title],[aria-label]').length===0};
	window.material_view=View;return Output;
};`;
writeFileSync(join(Directory, "fixture.html"), `<!doctype html><meta charset="utf-8"><style>${readFileSync(Css, "utf8")}${readFileSync("styles.css", "utf8")}</style><body class="theme-dark"><script>${Fixture}</script><script src="view.js"></script><script>${Case}</script>`);
const Child = spawn(Browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(Directory, "profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let Socket;
try
{
	let Port;
	for(let I = 0; I < 100; I++) { try { Port = Number(readFileSync(join(Directory, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await new Promise(R => setTimeout(R, 100)); } }
	assert.ok(Port);
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(P => P.type === "page").webSocketDebuggerUrl);
	await new Promise((R, J) => { Socket.onopen = R; Socket.onerror = J; });
	let Sequence = 0; const Pending = new Map();
	Socket.onmessage = Event => { const D = JSON.parse(Event.data), P = Pending.get(D.id); if(P) { Pending.delete(D.id); D.error ? P.reject(D.error) : P.resolve(D.result); } };
	function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++Sequence; Pending.set(id, { resolve, reject }); Socket.send(JSON.stringify({ id, method, params })); }); }
	await call("Page.navigate", { url: pathToFileURL(join(Directory, "fixture.html")).href });
	await new Promise(R => setTimeout(R, 300));
	const Report = [];
	for(const Width of [320, 420])
	{
		await call("Emulation.setDeviceMetricsOverride", { width: Width, height: 720, deviceScaleFactor: 1, mobile: false });
		const Result = await call("Runtime.evaluate", { expression: `document.body.className='${Width === 320 ? "theme-light is-mobile is-tablet" : "theme-dark"}';material_case(${Width})`, awaitPromise: true, returnByValue: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
		Report.push({ Width, ...Result.result.value });
		const Shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: 720, scale: 1 } });
		writeFileSync(join(Directory, `material-${Width}.png`), Buffer.from(Shot.data, "base64"));
		await call("Runtime.evaluate", { expression: "material_view.ContextPanel.hide();document.querySelector('#material-fixture .codex-navigation').open=false" });
		const Reading = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: 720, scale: 1 } });
		writeFileSync(join(Directory, `reading-${Width}.png`), Buffer.from(Reading.data, "base64"));
		await call("Runtime.evaluate", { expression: "material_view.onClose().then(()=>document.getElementById('material-fixture').remove())", awaitPromise: true });
	}
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2));
	console.log(JSON.stringify({ Directory, Report }));
	for(const Row of Report) { assert.ok(Object.entries(Row).every(([K, V]) => K === "Width" || V === true), JSON.stringify(Row)); }
}
finally { Socket?.close(); Child.kill(); }
