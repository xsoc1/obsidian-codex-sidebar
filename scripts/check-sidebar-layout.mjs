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
await build({ stdin: { contents: 'export * from "./src/sidebar-layout"; export { observe_sidebar_footer } from "./src/sidebar-footer"; export { EditOptions } from "./src/edit/options"; export { ComposerActions } from "./src/edit/composer"; export { SelectionPreview } from "./src/selection-preview";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "iife", globalName: "Layout", outfile: join(Directory, "layout.js") });
const Baseline = execFileSync("git", ["show", "665d76f:styles.css"], { encoding: "utf8" });
// Keep the original folding comparison above; UI polish compares the same current DOM.
const PolishBaseline = execFileSync("git", ["show", "9d80263:styles.css"], { encoding: "utf8" });
const Styles = readFileSync("styles.css", "utf8");
writeFileSync(join(Directory, "fixture.html"), `<!doctype html><html><meta charset="utf-8"><style>${readFileSync(AppCss, "utf8")}</style><style id="plugin"></style><body class="is-mobile is-tablet theme-dark"><div id="root" class="codex-sidebar" style="position:fixed;top:0;left:0;width:450px;height:519px"></div><script src="layout.js"></script><script>
function el(parent,tag,cls,text){const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;parent.appendChild(e);return e;}
HTMLElement.prototype.createEl=function(tag,o={}){const e=el(this,tag,o.cls,o.text);if(o.value!==undefined)e.value=o.value;Object.entries(o.attr||{}).forEach(([k,v])=>e.setAttribute(k,v));return e;};
HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o);};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o);};HTMLElement.prototype.setText=function(t){this.textContent=t;};
function render(folded,css,height,width,mobile=true,currentComposer=css===styles)
{
	document.getElementById('plugin').textContent=css;
	const r=document.getElementById('root');
	r.replaceChildren();r.style.height=height+'px';r.style.width=width+'px';
	const nav=folded?Layout.sidebar_panel(r,'codex-navigation','会话与连接 · 微型李代数讲义',mobile):{Body:r};
	const h=el(nav.Body,'div','codex-header');
	el(h,'strong','','Codex');el(h,'button','','新会话');el(h,'button','','重连');
	el(el(nav.Body,'select','codex-sessions'),'option','','微型李代数讲义');
	el(r,'div','codex-status','回复完成 | math-writing 就绪');
	window.selectionCard=new Layout.SelectionPreview(r,()=>selectionCard.update(null,true));
	const c=Layout.sidebar_panel(r,'codex-context-tools','上下文与学习',true);
	const a=el(c.Body,'div','codex-context-actions');
	['捕获当前位置','选择 PDF 页','解释选区','检查证明'].forEach(t=>el(a,'button','',t));
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
	const o=Layout.sidebar_panel(p,'codex-options','模型与选项 · gpt-6.1-sol / xhigh',mobile);
	const controls=el(o.Body,'div','codex-controls');
	['模型','思考档次'].forEach(t=>{const l=el(controls,'label','',t);el(el(l,'select'),'option','',t==='模型'?'gpt-6.1-sol':'xhigh');});
	const toggles=el(o.Body,'div','codex-run-toggles');
	['Fast','上下文占用','行内补全'].forEach(t=>{const l=el(toggles,'label');const input=el(l,'input');input.type='checkbox';el(l,'span','',t);});
	el(o.Body,'div','codex-usage','上下文 ~28%');
	const send=folded?Layout.sidebar_panel(p,'codex-send-tools','提问与发送',mobile):{Body:p};
	const input=el(send.Body,'textarea');input.placeholder='随时提问... Enter 提问, Shift+Enter 换行';
	if(currentComposer)window.editOptions=new Layout.EditOptions(send.Body,()=>{});
	const actions=el(send.Body,'div','codex-compose-actions');
	window.submissions=[];if(currentComposer)window.composerActions=new Layout.ComposerActions(actions,input,mode=>submissions.push(mode),()=>{});else{el(actions,'button','','发送');el(actions,'button','','停止');}
	return {messageHeight:m.getBoundingClientRect().height,rootHeight:r.clientHeight,scrollHeight:r.scrollHeight,composerHeight:p.getBoundingClientRect().height};
}
function render_polish(css,height,width,mobile)
{
	render(true,css,height,width,mobile,true);
	const root=document.getElementById('root');
	root.scrollTop=0;
	for(const panel of root.querySelectorAll('.codex-navigation,.codex-context-tools,.codex-options,.codex-send-tools'))panel.open=false;
	const messages=root.querySelector('.codex-messages');messages.replaceChildren();
	const user=el(messages,'div','codex-message codex-user');el(user,'div','codex-message-label','你');el(user,'div','codex-message-body','为什么矩阵交换子仍然是线性的？');
	const card=el(messages,'div','codex-message codex-assistant');el(card,'div','codex-message-label','Codex');
	const body=el(card,'div','codex-message-body');
	el(body,'h3','','先看定义，再连接计算');
	el(body,'p','','固定矩阵 X 后，交换子为 [X,Y] = XY − YX。要理解第二个变量的线性，只需把加法和数乘分别代入。');
	el(body,'p','','矩阵乘法的分配律给出 [X,Y+Z] = [X,Y] + [X,Z]；数乘同理。这一步保留原来的条件，也说明了下一步为什么能逐项计算。');
	el(body,'p','','例如 E₁₂E₂₁ = E₁₁，而 E₂₁E₁₂ = E₂₂，所以 [E₁₂,E₂₁] = E₁₁ − E₂₂。');
	return root;
}
function reading_metrics()
{
	const root=document.getElementById('root'),messages=root.querySelector('.codex-messages'),body=root.querySelector('.codex-assistant .codex-message-body');
	return {height:messages.getBoundingClientRect().height,width:body.getBoundingClientRect().width,rootWidth:root.clientWidth,scrollWidth:root.scrollWidth};
}
function long_content()
{
	const body=document.querySelector('.codex-assistant .codex-message-body');
	const math=el(body,'div','math-block');const formula=el(math,'span','','[X,[Y,Z]] + [Y,[Z,X]] + [Z,[X,Y]] = 0');formula.style.cssText='display:inline-block;width:1200px;white-space:nowrap';
	const pre=el(body,'pre');el(pre,'code','','original_example = '+ 'matrix_product_'.repeat(90));
	const table=el(body,'table');const row=el(el(table,'tbody'),'tr');
	for(let i=0;i<12;i++){const cell=el(row,'td','','X'+i+'Y'+i+' − Y'+i+'X'+i);cell.style.minWidth='110px';}
	return [math,pre,table];
}
function complete_button(button)
{
	const range=document.createRange();range.selectNodeContents(button);
	const bounds=button.getBoundingClientRect(),text=[...range.getClientRects()],style=getComputedStyle(button);
	return {text:button.textContent,visible:button.checkVisibility(),width:bounds.width,height:bounds.height,textLines:new Set(text.map(rect=>Math.round(rect.top))).size,paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,fontSize:style.fontSize,whiteSpace:style.whiteSpace,complete:button.scrollWidth<=button.clientWidth+1&&button.scrollHeight<=button.clientHeight+1&&text.every(rect=>rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1)};
}
function reachable_button(button)
{
	button.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
	if(!button.checkVisibility())return false;
	const bounds=button.getBoundingClientRect();
	for(let parent=button.parentElement;parent;parent=parent.parentElement)
	{
		const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
		const left=rect.left+parent.clientLeft,top=rect.top+parent.clientTop;
		const root=parent.id==='root';
		if((root||['hidden','clip','auto','scroll'].includes(style.overflowX))&&(bounds.left<left-1||bounds.right>left+parent.clientWidth+1))return false;
		if((root||['hidden','clip','auto','scroll'].includes(style.overflowY))&&(bounds.top<top-1||bounds.bottom>top+parent.clientHeight+1))return false;
		if(root)break;
	}
	return true;
}
window.styles=${JSON.stringify(Styles)};window.baseline=${JSON.stringify(Baseline)};window.polishBaseline=${JSON.stringify(PolishBaseline)};</script></body></html>`);
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
			const explicitActionsVisible=composerActions.Question.checkVisibility()&&composerActions.Preview.checkVisibility();
			composerActions.refresh(false,false,false);composerActions.Preview.click();
			input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true}));
			const routes=submissions.join(',')==='edit,question';
			edit.open=true;editOptions.Scope.value='captured';edit.open=false;edit.open=true;
			const editPreserved=explicitActionsVisible&&routes&&editOptions.Scope.value==='captured'&&editOptions.values().Role==='auto'&&edit.querySelectorAll('select').length===1&&[...edit.querySelectorAll('select')].every(s=>s.labels.length===1);edit.open=false;
			const focusRestored=document.activeElement===input;
			options.open=true;const select=options.querySelector('select');select.value='gpt-6.1-sol';options.open=false;
			navigation.querySelector('summary').click();const session=navigation.querySelector('select');const selectedSession=session.value;navigation.querySelector('summary').click();
			root.scrollTop=root.scrollHeight;
			const send=[...root.querySelectorAll('button')].find(e=>e.textContent==='生成修改预览');
			const rect=send.getBoundingClientRect(),bounds=root.getBoundingClientRect();
			return {theme:'${Theme}',width:${Width},height:${Height},before,after,defaultFolded,initiallyHidden,draftPreserved,editFolded,editPreserved,focusRestored,sendReachable:rect.bottom<=bounds.bottom&&rect.top>=bounds.top,preserved:select.value==='gpt-6.1-sol'&&session.value===selectedSession,contextClosed:!root.querySelector('.codex-context-tools').open,optionsClosed:!options.open,navigationClosed:!navigation.open,overflow:root.scrollWidth>root.clientWidth,hover:root.querySelectorAll('[title],[aria-label]').length};
		})()`, returnByValue: true });
		assert.ok(!Result.exceptionDetails, "Fixture evaluation failed");
		const Row = Result.result.value; Rows.push(Row);
		assert.ok(Row.after.messageHeight > Row.before.messageHeight + (Height > 400 ? 70 : 0), "Controls still squeeze the answer area");
		assert.ok(Row.defaultFolded && Row.initiallyHidden && Row.draftPreserved && Row.editFolded && Row.editPreserved && Row.focusRestored && Row.sendReachable && Row.preserved && Row.contextClosed && Row.optionsClosed && Row.navigationClosed && !Row.overflow && !Row.hover, JSON.stringify(Row));
	}
	for(const Theme of ["theme-dark", "theme-light"])
	for(const [Width, Height] of [[450,720],[320,620]])
	{
		const Result = await call("Runtime.evaluate", { expression: `(()=>{
			document.body.className='${Theme}';render(true,styles,${Height},${Width},false);
			const root=document.getElementById('root'), nav=root.querySelector('.codex-navigation'), context=root.querySelector('.codex-context-tools'), options=root.querySelector('.codex-options'), compose=root.querySelector('.codex-send-tools');
			const defaults=!nav.open&&!context.open&&!options.open&&compose.open;
			const input=compose.querySelector('textarea');input.value='中文草稿, 不因折叠丢失';input.setSelectionRange(2,4);
			compose.open=false;Layout.reveal_sidebar_panel({Details:compose});input.focus();
			const preserved=input.value==='中文草稿, 不因折叠丢失'&&input.selectionStart===2&&document.activeElement===input;
			const sample={Path:'Original.md',Kind:'选区',Mapping:'源块',SelectedText:'x+y=1',Text:'$$ x+y=1 $$',CapturedAt:'original-time',Truncated:true};selectionCard.update(sample,true);
			const card=root.querySelector('.codex-note-selection');const selectionVisible=card.checkVisibility()&&card.open&&!context.open&&card.parentElement===root;
			const rawPreserved=card.querySelectorAll('pre')[1].textContent.includes('$$');
			const before=card.open;card.open=false;selectionCard.update(sample,true);const foldPreserved=!card.open;card.open=before;
			nav.open=true;nav.open=false;options.open=true;options.open=false;
			return {surface:'desktop',theme:'${Theme}',width:${Width},height:${Height},defaults,preserved,selectionVisible,rawPreserved,foldPreserved,messageHeight:root.querySelector('.codex-messages').clientHeight,overflow:root.scrollWidth>root.clientWidth,hover:root.querySelectorAll('[title],[aria-label]').length};
		})()`, returnByValue: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails)); const Row = Result.result.value; Rows.push(Row);
		assert.ok(Row.defaults && Row.preserved && Row.selectionVisible && Row.rawPreserved && Row.foldPreserved && Row.messageHeight >= 120 && !Row.overflow && !Row.hover, JSON.stringify(Row));
	}
	const PolishRows = [];
	for(const Theme of ["theme-dark", "theme-light"])
	for(const Mobile of [false, true])
	for(const Width of [240,320,450,612])
	{
		const Height = Width === 240 ? 520 : 720;
		const Surface = Mobile ? "mobile" : "desktop";
		await call("Emulation.setDeviceMetricsOverride", { width: Math.max(Width,512), height: Height + 20, deviceScaleFactor: 1, mobile: false });
		const Before = await call("Runtime.evaluate", { expression: `(()=>{
			document.body.className='${Mobile ? "is-mobile is-tablet " : ""}${Theme}';
			render_polish(polishBaseline,${Height},${Width},${Mobile});
			window.polishInput=document.querySelector('.codex-send-tools textarea');polishInput.value='中文草稿与 $[X,Y]$';polishInput.setSelectionRange(2,4);
			window.polishScope=editOptions.Scope;polishScope.value='captured';
			window.polishBefore=reading_metrics();return polishBefore;
		})()`, returnByValue: true });
		assert.ok(!Before.exceptionDetails, JSON.stringify(Before.exceptionDetails));
		const Capture = Width === (Mobile ? 320 : 612);
		if(Capture)
		{
			const Shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: Height, scale: 1 } });
			writeFileSync(join(Directory, `before-${Surface}-${Theme}.png`), Buffer.from(Shot.data, "base64"));
		}
		const Comparison = await call("Runtime.evaluate", { expression: `(()=>{
			document.getElementById('plugin').textContent=styles;
			const root=document.getElementById('root');
			return {before:polishBefore,after:reading_metrics(),sameNodes:polishInput===root.querySelector('.codex-send-tools textarea')&&polishScope===editOptions.Scope,draftPreserved:polishInput.value==='中文草稿与 $[X,Y]$'&&polishInput.selectionStart===2&&polishInput.selectionEnd===4,scopePreserved:polishScope.value==='captured',foldsPreserved:[...root.querySelectorAll('.codex-navigation,.codex-context-tools,.codex-options,.codex-send-tools')].every(panel=>!panel.open)};
		})()`, returnByValue: true });
		assert.ok(!Comparison.exceptionDetails, JSON.stringify(Comparison.exceptionDetails));
		const Sizes = Comparison.result.value;
		assert.ok(Sizes.after.width + 0.5 >= Sizes.before.width && Sizes.after.height + 0.5 >= Sizes.before.height, `Folded reading area regressed: ${JSON.stringify({ Theme, Mobile, Width, ...Sizes })}`);
		assert.ok(Sizes.sameNodes && Sizes.draftPreserved && Sizes.scopePreserved && Sizes.foldsPreserved, JSON.stringify(Sizes));
		if(Capture)
		{
			const Shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: Height, scale: 1 } });
			writeFileSync(join(Directory, `after-${Surface}-${Theme}.png`), Buffer.from(Shot.data, "base64"));
		}
		const Result = await call("Runtime.evaluate", { expression: `(async()=>{
			const root=document.getElementById('root');
			const stress=long_content();
			const localOverflow=stress.map(item=>({tag:item.tagName,className:item.className,width:item.clientWidth,scrollWidth:item.scrollWidth,parentWidth:item.parentElement.clientWidth,overflow:getComputedStyle(item).overflowX}));
			const stressContained=root.scrollWidth<=root.clientWidth+1&&localOverflow.every(item=>item.width<=item.parentWidth+1&&item.scrollWidth>item.width&&['auto','scroll'].includes(item.overflow));
			for(const panel of root.querySelectorAll('details'))panel.open=true;
			composerActions.refresh(false,false,false);
			const buttons=[...root.querySelectorAll('.codex-header button,.codex-context-actions button,.codex-compose-actions button')].map(complete_button);
			const actions=[composerActions.Question,composerActions.Preview,composerActions.Stop];
			const before=actions.map(button=>{const r=button.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
			composerActions.refresh(true,true,false);
			const stableActions=actions.every((button,index)=>{const r=button.getBoundingClientRect();return [r.x,r.y,r.width,r.height].every((v,k)=>Math.abs(v-before[index][k])<0.5);});
			composerActions.refresh(false,false,false);
			const actionsReachable=actions.every(reachable_button);
			const allButtonsReachable=[...root.querySelectorAll('.codex-header button,.codex-context-actions button,.codex-compose-actions button')].every(reachable_button);
			const controls=root.querySelector('.codex-controls');const labels=[...controls.querySelectorAll('label')];
			const modelSingleColumn=labels[1].getBoundingClientRect().top>labels[0].getBoundingClientRect().top+1;
			window.submissions=[];
			const ime=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,cancelable:true});polishInput.dispatchEvent(ime);
			const shift=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,cancelable:true});polishInput.dispatchEvent(shift);
			const tab=new KeyboardEvent('keydown',{key:'Tab',cancelable:true});polishInput.dispatchEvent(tab);
			const question=new KeyboardEvent('keydown',{key:'Enter',cancelable:true});polishInput.dispatchEvent(question);
			const keyboardPreserved=!ime.defaultPrevented&&!shift.defaultPrevented&&!tab.defaultPrevented&&question.defaultPrevented&&submissions.join(',')==='question';
			const saved=new Map(),store={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
			const holder=el(document.body,'div');holder.style.cssText='position:fixed;left:-9999px';
			const first=Layout.sidebar_panel(holder,'codex-options','保存展开状态',true,{Storage:store,Key:'fixture-fold'});first.Details.open=true;
			await new Promise(resolve=>setTimeout(resolve,0));
			const restored=Layout.sidebar_panel(holder,'codex-options','恢复展开状态',true,{Storage:store,Key:'fixture-fold'});
			const savedFoldRestored=restored.Details.open&&saved.get('fixture-fold')==='open';holder.remove();
			window.polishSpinner=el(root,'div','codex-spinner');polishSpinner.style.position='absolute';polishSpinner.style.left='-9999px';
			composerActions.Question.focus();
			return {buttons,stableActions,actionsReachable,allButtonsReachable,localOverflow,stressContained,modelSingleColumn,keyboardPreserved,savedFoldRestored,overflow:root.scrollWidth>root.clientWidth+1,hover:root.querySelectorAll('[title],[aria-label]').length};
		})()`, returnByValue: true, awaitPromise: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
		await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
		await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
		const Focus = await call("Runtime.evaluate", { expression: `(()=>{const button=composerActions.Preview,style=getComputedStyle(button);return {target:document.activeElement===button,visible:button.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth),shadow:style.boxShadow};})()`, returnByValue: true });
		await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
		const Motion = await call("Runtime.evaluate", { expression: "({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(polishSpinner).animationName,scroll:getComputedStyle(document.querySelector('.codex-messages')).scrollBehavior})", returnByValue: true });
		await call("Emulation.setEmulatedMedia", { features: [] });
		const Row = { surface: Surface, theme: Theme, width: Width, height: Height, ...Sizes, ...Result.result.value, focus: Focus.result.value, motion: Motion.result.value };
		PolishRows.push(Row);
		assert.ok(Row.buttons.every(Button => Button.complete && Button.visible) && Row.buttons.some(Button => Button.text === "选择 PDF 页") && Row.buttons.some(Button => Button.text === "生成修改预览"), `Incomplete button: ${JSON.stringify(Row)}`);
		assert.ok(Row.stableActions && Row.actionsReachable && Row.allButtonsReachable && Row.stressContained && Row.keyboardPreserved && Row.savedFoldRestored && !Row.overflow && !Row.hover, JSON.stringify(Row));
		if(Width === 240) { assert.ok(Row.modelSingleColumn, "Narrow sidebar should stack model selectors"); }
		assert.ok(Row.focus.target && Row.focus.visible && ((Row.focus.outline !== "none" && Row.focus.width > 0) || Row.focus.shadow !== "none"), JSON.stringify(Row.focus));
		assert.ok(Row.motion.reduced && Row.motion.animation === "none" && Row.motion.scroll === "auto", JSON.stringify(Row.motion));
		if((!Mobile && Width === 612 && Theme === "theme-dark") || (Mobile && Width === 240 && Theme === "theme-light"))
		{
			await call("Emulation.setDeviceMetricsOverride", { width: Math.max(Width,512), height: 740, deviceScaleFactor: 1, mobile: false });
			const Expanded = await call("Runtime.evaluate", { expression: `(()=>{
				const root=render_polish(styles,720,${Width},${Mobile});
				root.querySelector('.codex-options').open=true;root.querySelector('.codex-send-tools').open=true;
				const input=root.querySelector('.codex-send-tools textarea');input.value='解释这里的分配律，并完整连接前后的计算。';
				composerActions.refresh(false,false,false);root.scrollTop=root.scrollHeight;
				const bounds=root.getBoundingClientRect();
				const controls=[...root.querySelectorAll('.codex-controls select'),input,composerActions.Question,composerActions.Preview,composerActions.Stop];
				return {height:720,controlsVisible:controls.every(control=>{const r=control.getBoundingClientRect();return control.checkVisibility()&&r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&r.left>=bounds.left-1&&r.right<=bounds.right+1;}),buttons:[composerActions.Question,composerActions.Preview,composerActions.Stop].map(complete_button)};
			})()`, returnByValue: true });
			assert.ok(!Expanded.exceptionDetails, JSON.stringify(Expanded.exceptionDetails));
			Row.expanded = Expanded.result.value;
			assert.ok(Row.expanded.controlsVisible && Row.expanded.buttons.every(Button => Button.complete) && Row.expanded.buttons[0].textLines === 1, JSON.stringify(Row.expanded));
			const Shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Width, height: 720, scale: 1 } });
			writeFileSync(join(Directory, `expanded-${Surface}-${Width}-${Theme}.png`), Buffer.from(Shot.data, "base64"));
		}
	}
	const FooterRows = [];
	for(const Theme of ["theme-dark", "theme-light"])
	for(const Width of [240,540])
	{
		await call("Emulation.setDeviceMetricsOverride", { width: Width, height: 620, deviceScaleFactor: 1, mobile: false });
		const Result = await call("Runtime.evaluate", { expression: `(async()=>{
			document.body.className='${Theme}';render_polish(styles,620,${Width},false);
			const root=document.getElementById('root'),send=root.querySelector('.codex-send-tools');send.open=true;
			const bar=el(document.body,'div','status-bar','6 条反向链接 · 原创测试');
			bar.style.cssText='position:fixed;bottom:0;right:0;width:480px;height:27px;box-sizing:border-box;z-index:15';
			const close=Layout.observe_sidebar_footer(root);
			const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
			const measure=()=>{root.scrollTop=root.scrollHeight;const footer=bar.getBoundingClientRect();return [...root.querySelectorAll('.codex-compose-actions button')].map(button=>{const r=button.getBoundingClientRect();const x=Math.max(r.left,footer.left),right=Math.min(r.right,footer.right);return {text:button.textContent,bottom:r.bottom,footerTop:footer.top,occluded:x<right&&r.bottom>footer.top&&r.top<footer.bottom};});};
			await settle();const visible=measure();bar.style.height='48px';await settle();const taller=measure();
			bar.style.display='none';await settle();const hiddenPadding=parseFloat(getComputedStyle(root).paddingBottom);
			bar.style.display='flex';await settle();const shown=measure();
			bar.style.left='${Width+10}px';bar.style.right='auto';await settle();const separatePadding=parseFloat(getComputedStyle(root).paddingBottom);
			bar.remove();await settle();const removedPadding=parseFloat(getComputedStyle(root).paddingBottom);
			const replacement=el(document.body,'div','status-bar','新的状态栏');replacement.style.cssText='position:fixed;bottom:0;right:0;width:480px;height:27px;z-index:15';await settle();const recreatedPadding=parseFloat(getComputedStyle(root).paddingBottom);
			close();replacement.style.height='48px';await settle();const disposed=!root.style.getPropertyValue('--codex-footer-inset');replacement.remove();
			return {visible,taller,shown,hiddenPadding,separatePadding,removedPadding,recreatedPadding,disposed};
		})()`, returnByValue: true, awaitPromise: true });
		assert.ok(!Result.exceptionDetails, JSON.stringify(Result.exceptionDetails));
		const Row={theme:Theme,width:Width,...Result.result.value};FooterRows.push(Row);
		assert.ok([...Row.visible,...Row.taller,...Row.shown].every(Button=>!Button.occluded), `Status bar occludes send actions: ${JSON.stringify(Row)}`);
		assert.equal(Row.hiddenPadding,12);assert.equal(Row.separatePadding,12);assert.equal(Row.removedPadding,12);assert.equal(Row.recreatedPadding,39);assert.ok(Row.disposed);
	}
	await call("Emulation.setDeviceMetricsOverride", { width: 350, height: 740, deviceScaleFactor: 1, mobile: false });
	await call("Runtime.evaluate", { expression: "document.body.className='theme-dark';render(true,styles,720,320,false)" });
	const Shot = await call("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(Directory, "after.png"), Buffer.from(Shot.data, "base64"));
	writeFileSync(join(Directory, "report.json"), JSON.stringify({ tier: "headless CSS fixture with simulated wide math, not native MathJax, manual IME or iPad device acceptance", baseline: "0.14.0 / 9d80263", rows: Rows, polishRows: PolishRows, footerRows: FooterRows }, null, 2));
	console.log(JSON.stringify({ directory: Directory, legacyCases: Rows.length, polishCases: PolishRows.length, footerCases: FooterRows.length, rows: Rows, polishRows: PolishRows, footerRows: FooterRows }, null, 2));
}
finally { Socket?.close(); Child.kill(); }
