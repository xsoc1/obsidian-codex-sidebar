// Same-machine actual CodexView SDK comparison; not native MathJax or device acceptance.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { build } from "esbuild";

const Browser = process.env.CODEX_LAYOUT_BROWSER;
if(!Browser) { throw Error("Set CODEX_LAYOUT_BROWSER to an installed Chromium browser"); }
const Baseline = process.env.CODEX_HISTORY_BASELINE ?? "4cc440be3e77dcd16d893ff6d9d7bcf1eee90b6a";
const Directory = mkdtempSync(join(tmpdir(), "codex-history-refresh-"));
for(const Old of [true, false])
{
	await build({ stdin: { contents: 'export { CodexView } from "./view";', resolveDir: join(process.cwd(), "src"), loader: "ts" }, plugins: Old ? [{ name: "pinned-baseline", setup(B)
	{
		B.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, Args =>
		{
			const Path = relative(process.cwd(), Args.path).replaceAll("\\", "/"); let Text = execFileSync("git", ["show", Baseline + ":" + Path], { encoding: "utf8" });
			if(Path === "src/history-view-state.ts") { Text = Text.replace('export function history_source_index(Messages: readonly ChatMessage[])\n{', 'export function history_source_index(Messages: readonly ChatMessage[])\n{\n(globalThis as any).__HistoryMetrics.ScannedMessages += Messages.length;'); }
			if(Path === "src/sources.ts") { Text = Text.replace('export function source_reference(Context: ContextSnapshot, Host: SourceReference["Host"] = "client-snapshot"): SourceReference[]\n{', 'export function source_reference(Context: ContextSnapshot, Host: SourceReference["Host"] = "client-snapshot"): SourceReference[]\n{\n(globalThis as any).__HistoryMetrics.SourceBuilds++;'); }
			return { contents: Text, loader: "ts" };
		});
	} }] : [], external: ["obsidian", "@codemirror/state", "@codemirror/view", "node:*"], bundle: true, platform: "browser", format: "iife", globalName: Old ? "BaselineSidebar" : "CandidateSidebar", outfile: join(Directory, Old ? "baseline.js" : "candidate.js") });
}
const Fixture = String.raw`
window.__HistoryMetrics={ScannedMessages:0,SourceBuilds:0};
window.run_refresh_case=async(Sidebar,Count)=>{
 const Root=document.body.createDiv({cls:'codex-sidebar'});Root.style.cssText='width:420px;height:480px';
 const List=Root.createDiv({cls:'codex-messages'});List.style.cssText='height:440px;overflow:auto';
 const Context={Path:'Original.md',Text:'原始来源 '.repeat(400),Kind:'选区',Mode:'阅读',Mapping:'源块',CapturedAt:'original',Truncated:false};
 const Messages=Array.from({length:Count},(_,I)=>({Id:'m'+I,Role:I%2?'assistant':'user',TurnId:'t'+Math.floor(I/2),Text:'原创证明 '+('设线性算子有界, 逐项估计. ').repeat(100),Prompt:I%2?undefined:'原创问题条件 '.repeat(400),Context:I%2?undefined:{...Context},OperationId:I%2?undefined:'op'+I}));
 const Operations=new Map(Messages.filter(M=>M.OperationId).map(M=>[M.OperationId,{Status:'completed',TurnId:M.TurnId,Attempted:true,Input:{Prompt:'不可变输入 '.repeat(400)},Request:{payload:'完整请求 '.repeat(400)}}]));
 const Owner={Session:{Id:'s',Messages},State:{},Capture:{LastView:null},Busy:true,TurnId:Messages.at(-1).TurnId,refresh(){},operation_state:Id=>Operations.get(Id)};
 const View=new Sidebar.CodexView({},Owner);View.MessagesElement=List;View.Opened=true;
 await View.render_messages();const Cards=[...List.querySelectorAll('[data-message-id]')];
 const State=()=>View.HistoryStates?.get(JSON.stringify(['desktop','s']));
 const Stats=()=>State()?{...State().Stats}:{...window.__HistoryMetrics};
 const PreviousJSON=JSON.stringify;let SerializedBytes=0;const Encode=new TextEncoder();
 JSON.stringify=function(...Args){const Value=PreviousJSON.apply(this,Args);if(typeof Value==='string')SerializedBytes+=Encode.encode(Value).length;return Value;};
 const Times=[],Before=Stats();
 for(let I=0;I<5;I++){const Start=performance.now();View.message_signature();Times.push(performance.now()-Start);}Times.sort((A,B)=>A-B);
 const SignBytes=SerializedBytes/5,AfterSign=Stats();SerializedBytes=0;
 const Body=Cards[0].querySelector('.codex-message-body'),Selection=window.getSelection(),Range=document.createRange();Range.selectNodeContents(Body);Selection.removeAllRanges();Selection.addRange(Range);const Selected=Selection.toString();
 window.RenderCalls=0;const OldText=Messages.at(-1).Text;Messages.at(-1).Text+=' 新增十六字符推导, 保持原路线.';View.history_changed?.('s',[Messages.at(-1).Id]);
 const BeforeStream=Stats(),Start=performance.now();await View.render_messages();const StreamMs=performance.now()-Start,StreamBytes=SerializedBytes,AfterStream=Stats();
 JSON.stringify=PreviousJSON;
 const Result={count:Count,visible:List.querySelectorAll('[data-message-id]').length,signatureMedianMs:Times[2],signatureSerializedBytes:SignBytes,signatureScannedMessages:(AfterSign.ScannedMessages-Before.ScannedMessages)/5,streamMs:StreamMs,streamSerializedBytes:StreamBytes,streamScannedMessages:AfterStream.ScannedMessages-BeforeStream.ScannedMessages,streamSourceBuilds:AfterStream.SourceBuilds-BeforeStream.SourceBuilds,streamCardRenders:window.RenderCalls,unchangedCardIdentity:Cards[0]===List.querySelector('[data-message-id]'),selectionPreserved:Selection.toString()===Selected};
 if(State()){
  Result.streamVisibleChecks=AfterStream.CheckedMessages-BeforeStream.CheckedMessages;Result.streamNavigationScans=AfterStream.NavigationScans-BeforeStream.NavigationScans;
  let CardRenders=0;const Render=View.render_card.bind(View);View.render_card=(...Args)=>{CardRenders++;return Render(...Args);};
  const Operation=Operations.get(Messages[Count-40].OperationId);Operation.Input.Prompt+=' evidence change';Operation.Request.payload+=' request change';await View.render_messages();Result.operationEvidenceDoesNotRerender=CardRenders===0;
  Operation.Status='failed';Operation.Error='Original explicit failure';await View.render_messages();Result.operationStatusRefreshes=CardRenders===1&&List.querySelector('.codex-operation-state').textContent==='失败';
  if(Count===240){
   View.contentEl=Root;View.Input=Root.createEl('textarea');View.QuoteElement=Root.createDiv();Owner.State.Settings={AttachContext:true};
   const SelectedBody=List.querySelector('.codex-assistant .codex-message-body'),QuoteRange=document.createRange();QuoteRange.selectNodeContents(SelectedBody);Selection.removeAllRanges();Selection.addRange(QuoteRange);View.capture_answer_selection();
   const Quote=View.SelectedAnswer;Owner.AnswerQuote=structuredClone(Quote);const SavedQuote=JSON.stringify(Owner.AnswerQuote),ContextKey=JSON.stringify(['desktop','s']);
   let Peak=0;for(let I=0;I<6;I++){View.HistoryWindow.older(ContextKey,Messages);View.LastRendered='';await View.render_messages();Peak=Math.max(Peak,List.querySelectorAll('[data-message-id]').length);}
   Result.mountCap=Peak;Result.crossWindowQuotePreserved=!!Quote&&JSON.stringify(Owner.AnswerQuote)===SavedQuote&&!List.querySelector('[data-message-id="'+Quote.MessageId+'"]');
   await View.reveal_message(Quote.MessageId);Result.quotedHistoryJump=!!List.querySelector('[data-message-id="'+Quote.MessageId+'"]');
   View.HistoryWindow.latest(ContextKey);View.LastRendered='';await View.render_messages();Result.returnToLatest=List.querySelectorAll('[data-message-id]').length===40&&!!List.querySelector('[data-message-id="m239"]');
  }
 }
 Messages.at(-1).Text=OldText;View.MessageList?.dispose();Selection.removeAllRanges();Root.remove();return Result;
};`;
writeFileSync(join(Directory, "fixture.html"), '<!doctype html><meta charset="utf-8"><style>body{font:14px sans-serif}.codex-message{padding:8px}</style><script>' + readFileSync("scripts/fixtures/stream-render.js", "utf8") + Fixture + '</script><script src="baseline.js"></script><script src="candidate.js"></script>');
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
	const Value = await Call("Runtime.evaluate", { expression: "(async()=>{const rows=[];for(const count of [240,1000,4000])rows.push({baseline:await run_refresh_case(BaselineSidebar,count),candidate:await run_refresh_case(CandidateSidebar,count)});return rows;})()", awaitPromise: true, returnByValue: true });
	assert.ok(!Value.exceptionDetails, JSON.stringify(Value.exceptionDetails)); const Rows = Value.result.value;
	for(const R of Rows)
	{
		assert.equal(R.candidate.visible, 40); assert.equal(R.candidate.streamScannedMessages, 0); assert.equal(R.candidate.streamNavigationScans, 0); assert.equal(R.candidate.streamSourceBuilds, 1);
		assert.equal(R.candidate.streamCardRenders, 1); assert.ok(R.candidate.unchangedCardIdentity && R.candidate.selectionPreserved);
		assert.ok(R.candidate.operationEvidenceDoesNotRerender && R.candidate.operationStatusRefreshes);
		if(R.candidate.count === 240) { assert.ok(R.candidate.mountCap <= 120 && R.candidate.crossWindowQuotePreserved && R.candidate.quotedHistoryJump && R.candidate.returnToLatest); }
		assert.ok(R.candidate.signatureSerializedBytes < 16000); assert.ok(R.candidate.streamSerializedBytes < 40000);
	}
	const Report = { tier: "actual CodexView + original SDK data, 40 mounted messages, same Chromium process; not native MathJax/device", timingIncludesUtf8ByteInstrumentation: true, rendererDelayMs: 18, baseline: Baseline, cases: Rows };
	writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
}
finally { Socket?.close(); Child.kill(); }
