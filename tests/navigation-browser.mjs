// Actual CodexView in an isolated Chromium fixture; renderer reflow, not native MathJax.
import { build } from "esbuild";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { relative } from "node:path";
import assert from "node:assert/strict";
const Browser = process.env.CODEX_LAYOUT_BROWSER;
if(!Browser) { throw Error("Set CODEX_LAYOUT_BROWSER to an installed Chromium executable"); }
const Directory = mkdtempSync(join(tmpdir(), "codex-reading-navigation-"));
const Baseline = process.env.CODEX_READING_BASELINE;
await build({ stdin: { contents: 'export { CodexView } from "./src/view"; export { markdown_blocks } from "./src/markdown-blocks"; export { answer_quote } from "./src/quote";', resolveDir: process.cwd(), loader: "ts" }, plugins: Baseline ? [{ name: "original-reading-baseline", setup(B)
{
	B.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, Args => ({ contents: execFileSync("git", ["show", Baseline + ":" + relative(process.cwd(), Args.path).replaceAll("\\", "/")], { encoding: "utf8" }), loader: "ts" }));
} }] : [], bundle: true, external: ["obsidian", "@codemirror/state", "@codemirror/view", "node:*"], platform: "browser", format: "iife", globalName: "Sidebar", outfile: join(Directory, "view.js") });
const Case = String.raw`
window.reading_case = async () => {
 const Root=document.body.createDiv();Root.id='reading-fixture';Root.style.cssText='width:420px;height:720px';
 const Long=Name=>'# '+Name+'\n\n'+Array.from({length:150},(_,I)=>Name+' 第 '+I+' 步. '+('沿原论证逐项核对一致有界性与极限交换. ').repeat(16)).join('\n\n')+'\n\n$$\\eta_{'+Name+'}=1$$\n\n尾部结论 '+Name;
 const Original={Id:'root',Role:'assistant',Text:Long('原始'),CompletionStatus:'completed',Phase:'final_answer',TurnId:'t0'};
 const Messages=[{Id:'q0',Role:'user',Text:'核对引理 A',TurnId:'t0'},Original,...Array.from({length:70},(_,I)=>({Id:'filler'+I,Role:I%2?'assistant':'user',Text:'第 '+I+' 个相近引理的说明',TurnId:'f'+Math.floor(I/2)}))];
 for(let I=1;I<=3;I++){Messages.push({Id:'q'+I,Role:'user',Text:'引理 A 的第 '+I+' 次追问',TurnId:'t'+I,Quote:Sidebar.answer_quote('s',I===1?'root':'a'+(I-1),'选中的公式',I===1?Original.Text:Messages.at(-1).Text,'completed',{RootMessageId:'root',ParentMessageId:I===1?'root':'a'+(I-1)})},{Id:'a'+I,Role:'assistant',Text:Long('整合'+I),TurnId:'t'+I,Phase:'final_answer',CompletionStatus:'completed'});}
 const Session={Id:'s',Title:'原创长证明',Messages},Other={Id:'b',Title:'另一会话',Messages:[{Id:'root',Role:'assistant',Text:'同名消息不得接受旧导航'}]};
 let Hold=null,Release=null,Retries=0;const Scope='navigation-fixture-'+crypto.randomUUID();
 const Owner={Session,State:{ActiveId:'s',Sessions:[Session,Other],Settings:{AttachContext:true,EditScope:'captured',Model:'fixture',Effort:'',ShowUsage:false,Completion:false}},Models:[],Inline:{get_suggestion:()=>null},Capture:{Snapshot:null},Busy:false,Status:'就绪',SkillStatus:'fixture',draft_scope:()=>Scope,persist:async()=>{},refresh(){},can_capture_pdf_box:()=>false,ensure_session_history:async()=>{if(Hold)await Hold;},PendingBackendSaves:[],BackendSaveBlocked:false,retry_backend_saves:async()=>{Retries++;}};
 const View=new Sidebar.CodexView({},Owner);View.contentEl=Root;View.app={vault:{getName:()=>Scope}};Owner.refresh=()=>View.refresh();await View.onOpen();await View.render_messages();
 const List=Root.querySelector('.codex-messages'),Context=JSON.stringify(['desktop','s']);
 const card=Id=>[...List.querySelectorAll('[data-message-id]')].find(E=>E.dataset.messageId===Id);
 const formula=Id=>card(Id)?.querySelector('[data-fixture-math]');
 const OriginalBlock=Sidebar.markdown_blocks(Original.Text).find(B=>B.Kind==='math');
 const Quote=Sidebar.answer_quote('s','root','原始公式',Original.Text,'completed',{Mapping:'source-blocks',Range:{From:OriginalBlock.From,To:OriginalBlock.To},BlockIds:[OriginalBlock.Id]});
 const NewFormula=formula('a3');List.scrollTop+=NewFormula.getBoundingClientRect().top-List.getBoundingClientRect().top-37;List.dispatchEvent(new Event('scroll'));const Before=NewFormula.getBoundingClientRect().top-List.getBoundingClientRect().top;const CapturedBefore=View.capture_reading?.();
 await View.reveal_message('root',Quote);const JumpExact=!!formula('root')&&Math.abs(formula('root').getBoundingClientRect().top-List.getBoundingClientRect().top-List.clientHeight/2)<100;
 const Return=[...card('root').querySelectorAll('button')].find(B=>B.textContent.startsWith('返回刚才阅读处')&&!B.hidden);
 const HasReturn=!!Return;const ReturnVisible=!!Return&&Return.getBoundingClientRect().top>=List.getBoundingClientRect().top-1&&Return.getBoundingClientRect().bottom<=List.getBoundingClientRect().bottom+1;
 if(!HasReturn){await View.onClose();Root.remove();return {JumpExact,HasReturn};}
 Root.style.width='320px';Messages.at(-1).Text+='\n\n流式追加后的结论仍保留原块';View.history_changed('s',['a3']);await View.return_reading();
 await new Promise(R=>requestAnimationFrame(()=>requestAnimationFrame(R)));const ReturnedAnchor=[...card('a3')?.querySelectorAll('[data-codex-answer-block]')??[]].find(E=>E.dataset.codexAnswerBlock===CapturedBefore?.Block?.Id);const ReturnedAnchorOffset=ReturnedAnchor?.getBoundingClientRect().top-List.getBoundingClientRect().top;const Returned=!!ReturnedAnchor&&Math.abs(ReturnedAnchorOffset-CapturedBefore.Offset)<2;
 await View.return_reading();const SwapBack=!!formula('root');await View.return_reading();const SwapAgain=!!formula('a3');
 Hold=new Promise(R=>Release=R);const Pending=View.reveal_message('root',Quote);await Promise.resolve();List.dispatchEvent(new WheelEvent('wheel',{deltaY:-80}));List.scrollTop-=80;List.dispatchEvent(new Event('scroll'));const UserTop=List.scrollTop;Release();await Pending;Hold=null;
 const UserScrollWins=!!card('a3')&&Math.abs(List.scrollTop-UserTop)<2;
 Hold=new Promise(R=>Release=R);const Switching=View.reveal_message('root',Quote);await Promise.resolve();Owner.Session=Other;Owner.State.ActiveId='b';View.refresh();await View.render_messages();Release();await Switching;Hold=null;const SessionWins=List.textContent.includes('同名消息不得接受旧导航')&&!List.textContent.includes('原始 第');
 Owner.Session=Session;Owner.State.ActiveId='s';View.refresh();await View.render_messages();
 Hold=new Promise(R=>Release=R);const Deleting=View.reveal_message('root',Quote);await Promise.resolve();const At=Messages.indexOf(Original);Messages.splice(At,1);View.history_changed('s');Release();await Deleting;Hold=null;const DeletedTargetRejected=!card('root');
 Owner.PendingBackendSaves=[{Key:'received-result',Scope,SessionId:'s',MessageId:'pending-message',Text:'# 原创回答\n\n完整回答已收到: 原创推导尚未保存\n\n$$x=1$$',Status:'completed',Saving:false,Error:'fixture storage unavailable'}];Owner.BackendSaveBlocked=true;View.refresh();await View.render_messages();
 const PendingArea=List.querySelector('.codex-pending-backend-save');const PendingReadable=!!PendingArea&&PendingArea.textContent.includes('原创推导尚未保存')&&PendingArea.textContent.includes('尚未保存')&&!PendingArea.querySelector('[data-message-id]')&&![...PendingArea.querySelectorAll('button')].some(B=>B.textContent==='采用');
 const PendingBody=PendingArea.querySelector('.codex-unsaved-body'),PendingMath=!!PendingBody.querySelector('[data-fixture-math]');Owner.PendingBackendSaves[0].Saving=true;Owner.PendingBackendSaves[0].Error='fixture retrying storage';View.refresh();await View.render_messages();const PendingStatusOnly=PendingArea.querySelector('.codex-pending-save-status').textContent.includes('正在重试保存')&&PendingArea.querySelector('.codex-pending-save-retry').disabled;for(let I=0;I<4;I++){View.refresh();await View.render_messages();}const PendingRenderOnce=window.PendingRenderCount===1&&List.querySelector('.codex-unsaved-body')===PendingBody;Owner.PendingBackendSaves[0].Saving=false;View.refresh();await View.render_messages();
 const Retry=[...PendingArea?.querySelectorAll('button')??[]].find(B=>B.textContent==='重试保存');Retry?.click();await Promise.resolve();const StorageRetry=Retries===1;const InputBlocked=View.Input.disabled;
 Owner.PendingBackendSaves=[];Owner.BackendSaveBlocked=false;View.refresh();await View.render_messages();const PendingCleared=!List.querySelector('.codex-pending-backend-save')&&!View.Input.disabled;
 const Report={Diagnostics:{OriginalOffset:CapturedBefore.Offset,RestoredOffset:ReturnedAnchorOffset,SourceChars:Original.Text.length,IntegratedRounds:3},JumpExact,HasReturn,ReturnVisible,Returned,SwapBack,SwapAgain,UserScrollWins,SessionWins,DeletedTargetRejected,PendingReadable,PendingMath,PendingRenderOnce,PendingStatusOnly,StorageRetry,InputBlocked,PendingCleared,MountBound:List.querySelectorAll('[data-message-id]').length<=120,NoOverflow:Root.scrollWidth<=Root.clientWidth+1};window.reading_view=View;return Report;
};`;
const Renderer = String.raw`
const Require=window.require;window.require=Name=>Name==='obsidian'?{...Require(Name),MarkdownRenderer:{render:async(_A,Text,Body)=>{if(Text.includes('原创推导尚未保存'))window.PendingRenderCount=(window.PendingRenderCount??0)+1;await Promise.resolve();for(const B of Sidebar.markdown_blocks(Text)){const N=Body.createEl(B.Kind==='heading'?'h3':B.Kind==='math'?'div':'p',{text:B.Text.replace(/^#+ /,'')});if(B.Kind==='math'){N.dataset.fixtureMath='true';N.className='math-display';N.style.cssText='height:52px;display:block;font-size:18px';}}}}}:Require(Name);`;
writeFileSync(join(Directory,"fixture.html"),'<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif;background:#fafafa;color:#222}button,textarea,select{font:inherit}'+readFileSync('styles.css','utf8')+'</style><script>'+readFileSync('scripts/fixtures/stream-render.js','utf8')+Renderer+'</script><script src="view.js"></script><script>'+Case+'</script>');
const Child=spawn(Browser,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${join(Directory,'profile')}`,'--no-first-run','--disable-extensions','about:blank'],{windowsHide:true,stdio:'ignore'});
let Socket;
try
{
 let Port;for(let I=0;I<100;I++){try{Port=Number(readFileSync(join(Directory,'profile','DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{await new Promise(R=>setTimeout(R,100));}}
 assert.ok(Port);const Pages=await(await fetch(`http://127.0.0.1:${Port}/json/list`)).json();Socket=new WebSocket(Pages.find(P=>P.type==='page').webSocketDebuggerUrl);await new Promise((R,J)=>{Socket.onopen=R;Socket.onerror=J;});
 let Sequence=0;const Pending=new Map();Socket.onmessage=E=>{const V=JSON.parse(E.data),P=Pending.get(V.id);if(P){Pending.delete(V.id);V.error?P.reject(V.error):P.resolve(V.result);}};
 const Call=(method,params={})=>new Promise((resolve,reject)=>{const id=++Sequence;Pending.set(id,{resolve,reject});Socket.send(JSON.stringify({id,method,params}));});
 await Call('Page.navigate',{url:pathToFileURL(join(Directory,'fixture.html')).href});await new Promise(R=>setTimeout(R,250));
 const Value=await Call('Runtime.evaluate',{expression:'reading_case()',awaitPromise:true,returnByValue:true});assert.ok(!Value.exceptionDetails,JSON.stringify(Value.exceptionDetails));const Report=Value.result.value;
 const Shot=await Call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:420,height:720,scale:1}});writeFileSync(join(Directory,'reading.png'),Buffer.from(Shot.data,'base64'));writeFileSync(join(Directory,'report.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({Directory,Report}));
 await Call('Runtime.evaluate',{expression:'reading_view?.onClose()',awaitPromise:true});assert.ok(Object.entries(Report).every(([K,V])=>K==='Diagnostics'||V===true),JSON.stringify(Report));
}
finally{Socket?.close();Child.kill();}
