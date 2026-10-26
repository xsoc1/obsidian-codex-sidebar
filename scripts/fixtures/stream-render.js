class Component { load() {} unload() {} registerDomEvent() {} }
class ItemView extends Component { constructor() { super(); this.app = {}; } }
const Define = () => ({});
window.RenderCalls = 0;
window.RenderPaths = [];
window.require = Name =>
{
	if(Name === "obsidian")
	{
		return { Component, ItemView, Plugin: Component, PluginSettingTab: Component, Modal: Component, MarkdownView: Component, Notice: Component, Platform: { isMobile: false }, MarkdownRenderer: { render: async (_App, Text, Body, SourcePath) => { window.RenderCalls++; window.RenderPaths.push(SourcePath); await new Promise(Resolve => setTimeout(Resolve, 18)); Body.createEl("p", { text: Text }); if(Text.startsWith("现在展开")) { await window.StreamHook?.(Body); } } } };
	}
	if(Name === "@codemirror/state") { return { StateEffect: { define: Define }, StateField: { define: Define }, Prec: { highest: Define } }; }
	if(Name === "@codemirror/view") { return { WidgetType: Component, keymap: { of: Define }, ViewPlugin: { fromClass: Define } }; }
	throw Error("Unexpected browser import " + Name);
};
HTMLElement.prototype.createEl = function(Tag, Options = {})
{
	const Element = document.createElement(Tag); if(Options.cls) { Element.className = Options.cls; } if(Options.text) { Element.textContent = Options.text; } if(Options.value !== undefined) { Element.value = Options.value; }
	Object.entries(Options.attr || {}).forEach(([Name, Value]) => Element.setAttribute(Name, Value)); this.appendChild(Element); return Element;
};
HTMLElement.prototype.createDiv = function(Options) { return this.createEl("div", Options); };
HTMLElement.prototype.createSpan = function(Options) { return this.createEl("span", Options); };
HTMLElement.prototype.setText = function(Text) { this.textContent = Text; };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(Name) { this.classList.add(Name); };

window.run_simplified_sidebar_case = async (Keep = false, Width = 320) =>
{
	const Root = document.body.createDiv(); Root.style.cssText = `width:${Width}px;height:720px`; Root.id = 'simplified-sidebar-fixture';
	const Calls = [], Owner = { State: { Settings: { EditScope: "captured", AttachContext: true, Model: "fixture-model", Effort: "high", Fast: false, Completion: true, ShowUsage: false } }, Session: { Id: "fixture", Title: "原创微型讲义", Messages: [{ Id: "answer", Role: "assistant", Text: "固定矩阵 X 后，交换子为 [X,Y] = XY − YX。把加法与数乘分别代入，可验证其关于 Y 的线性。" }] }, Capture: { Snapshot: null }, Models: [{ model: "fixture-model", displayName: "模型示例", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], Inline: { get_suggestion: () => null }, Status: "就绪", SkillStatus: "math-writing", CatalogError: "", Busy: false, refresh() {}, async send_chat(...Args) { Calls.push(Args); return true; } };
	Owner.State.Sessions = [Owner.Session];
	const OriginalSession = Owner.Session, OriginalScope = 'draft-fixture-' + crypto.randomUUID(); let Scope = OriginalScope;
	Owner.draft_scope = () => Scope;
	let Deletions = 0; Owner.open_delete_session = () => { Deletions++; };
	const View = new Sidebar.CodexView({}, Owner); View.contentEl = Root; View.app = { vault: { getName: () => "disposable-sidebar-fixture" } };
	try
	{
		await View.onOpen();
		const DeleteButton = Root.querySelector('.codex-session-delete');
		DeleteButton.click(); const DeleteDelegated = Deletions === 1 && DeleteButton.textContent === '删除会话';
		Owner.SessionDeleting = true; View.refresh(); DeleteButton.click();
		const DeleteGuarded = DeleteButton.disabled && Deletions === 1 && View.SessionsElement.disabled;
		Owner.SessionDeleting = false; View.refresh();
		Root.querySelector('.codex-navigation').open = true;
		const Row = Root.querySelector('.codex-session-row').getBoundingClientRect();
		const SessionControlsFit = [...Root.querySelector('.codex-session-row').children].every(Element => { const Bounds = Element.getBoundingClientRect(); return Bounds.left >= Row.left - 1 && Bounds.right <= Row.right + 1; });
		Root.querySelector('.codex-navigation').open = false;
		const Text = Root.textContent;
		const RetiredAbsent = !Root.querySelector('.codex-note-session-status,.codex-note-session-toggle,.codex-edit-options,.codex-study-container') && !/随笔记切换会话|修改范围|数学学习工作台|笔记对应会话/.test(Text);
		View.Input.value = "修改选中的一段"; await View.send_input("edit");
		Owner.State.Settings.EditScope = "note"; View.Input.value = "修改当前笔记"; await View.send_input("edit");
		const Send = Owner.send_chat; let ReleaseDraft; Owner.send_chat = () => new Promise(Resolve => { ReleaseDraft = Resolve; });
		View.Input.value = 'Original pending draft'; const PendingSend = View.send_input('question'); View.Input.value = 'New draft typed during preparation'; ReleaseDraft(true); await PendingSend;
		const LatestDraftPreserved = View.Input.value === 'New draft typed during preparation';
		Owner.send_chat = async () => false; View.Input.value = 'Cancelled preparation draft'; await View.send_input('question');
		const CancelledDraftPreserved = View.Input.value === 'Cancelled preparation draft'; Owner.send_chat = Send; View.Input.value = '';
		const OriginalSnapshot = {Path:'Original.md',Kind:'选区',Mode:'阅读',Mapping:'源块',CapturedAt:'original-time',Text:'设 $[X,Y]=XY-YX$.',SelectedText:'$[X,Y]$',LineStart:0,LineEnd:0,Heading:'交换子',Truncated:false};
		Owner.Capture.Snapshot = OriginalSnapshot; View.Input.value = 'Restarted draft'; View.Input.dispatchEvent(new Event('input'));
		await View.onClose(); const NewSnapshot = {...OriginalSnapshot,Path:'Different.md',Text:'另一段当前笔记'}; Owner.Capture.Snapshot = NewSnapshot; await View.onOpen();
		const DraftRestarted = View.Input.value === 'Restarted draft' && Owner.Capture.Snapshot === NewSnapshot && Root.querySelector('.codex-draft-state').textContent.includes('恢复草稿来源/引用');
		[...Root.querySelectorAll('.codex-draft-state button')].find(B => B.textContent === '恢复草稿来源/引用').click();
		const DraftSourceExplicit = Owner.Capture.Snapshot.Path === 'Original.md' && Owner.Capture.Snapshot.Text === OriginalSnapshot.Text;
		const OtherSession = {...OriginalSession,Id:'other',Messages:[]}; Owner.Session = OtherSession; Owner.State.Sessions.push(OtherSession); Owner.Capture.Snapshot = null; View.refresh();
		const DraftSessionIsolated = View.Input.value === '';
		View.Input.value = 'Same words'; View.Input.dispatchEvent(new Event('input')); let ReleaseScope; Owner.send_chat = () => new Promise(R => {ReleaseScope = R;}); const ScopeSend = View.send_input('question');
		Scope = OriginalScope + '-other-connection'; View.refresh(); const DraftConnectionIsolated = View.Input.value === '';
		View.Input.value = 'Same words'; View.Input.dispatchEvent(new Event('input')); ReleaseScope(true); await ScopeSend;
		const LateScopeReceiptPreserved = View.Input.value === 'Same words'; Scope = OriginalScope; View.refresh();
		Owner.Session = OriginalSession; View.refresh(); const DraftSessionRestored = View.Input.value === 'Restarted draft';
		View.Input.value = ''; Owner.Capture.Snapshot = null; Owner.AnswerQuote = null; View.Input.dispatchEvent(new Event('input')); Owner.send_chat = Send;
		Owner.RuntimeState = {Stage:'preparing'}; Owner.CanStop = true; View.refresh();
		const PreparationButtons = [...Root.querySelectorAll('.codex-compose-actions button')];
		const PreparationStopReady = PreparationButtons[0].disabled && PreparationButtons[1].disabled && !PreparationButtons[2].disabled;
		Owner.RuntimeState = {Stage:'idle'}; Owner.CanStop = false; View.refresh();
		await View.render_messages();
		const Body = Root.querySelector('.codex-assistant .codex-message-body'), Selection = window.getSelection(), Range = document.createRange();
		Range.selectNodeContents(Body); Selection.removeAllRanges(); Selection.addRange(Range);
		View.capture_answer_selection(); const OrdinaryAnswerQuoted = !!View.SelectedAnswer;
		Body.dataset.editStructured = 'true'; View.capture_answer_selection(); const EditUiExcluded = View.SelectedAnswer === null;
		delete Body.dataset.editStructured; Selection.removeAllRanges(); View.capture_answer_selection();
		if(Keep)
		{
			for(const Selector of ['.codex-navigation','.codex-context-tools','.codex-send-tools']) { Root.querySelector(Selector).open = true; }
			View.Input.value = "请解释这一步的推导。";
			await View.render_messages();
		}
		const Actions = [...Root.querySelectorAll('.codex-compose-actions button')].map(Value => Value.textContent);
		const Toolbar = Root.querySelector('.codex-toolbar'), Composer = Root.querySelector('.codex-composer');
		const GlassScoped = !!Toolbar && Root.querySelector('.codex-options').parentElement === Toolbar && getComputedStyle(Toolbar).backdropFilter.includes('blur') && getComputedStyle(Composer).backdropFilter.includes('blur') && getComputedStyle(Root.querySelector('.codex-messages')).backdropFilter === 'none';
		View.SelectedAnswer = { SessionId: 'deleted-context' }; View.EditingSession = 'deleted-context'; View.EditingId = 'old-edit'; View.EditText = 'cancelled-edit';
		View.forget_session('deleted-context');
		const DeletedReferencesCleared = !View.SelectedAnswer && !View.EditingSession && !View.EditingId && !View.EditText;
		return { retiredAbsent: RetiredAbsent, glassScoped: GlassScoped, deleteDelegated: DeleteDelegated, deleteGuarded: DeleteGuarded, sessionControlsFit: SessionControlsFit, deletedReferencesCleared: DeletedReferencesCleared, latestDraftPreserved: LatestDraftPreserved, cancelledDraftPreserved: CancelledDraftPreserved, draftRestarted:DraftRestarted,draftSourceExplicit:DraftSourceExplicit,draftSessionIsolated:DraftSessionIsolated,draftConnectionIsolated:DraftConnectionIsolated,lateScopeReceiptPreserved:LateScopeReceiptPreserved,draftSessionRestored:DraftSessionRestored, preparationStopReady: PreparationStopReady, actionsRetained: Actions.join('|') === '提问|生成修改预览|停止', questionAndPreviewKeepSavedScope: Calls.length === 2 && Calls[0][3].Scope === 'captured' && Calls[1][3].Scope === 'note' && Calls.every(Value => Value[3].Mode === 'edit' && Value[3].Role === 'auto'), ordinaryAnswerQuoted: OrdinaryAnswerQuoted, editUiExcluded: EditUiExcluded, noOwnHover: Root.querySelectorAll('[title],[aria-label]').length === 0 };
	}
	finally { await View.onClose(); for(const K of Object.keys(localStorage)) { if(K.startsWith('codex-sidebar-composer:v1:' + encodeURIComponent(OriginalScope)))localStorage.removeItem(K); } if(!Keep) { Root.remove(); } }
};

window.run_stream_case = async (HistoryCount = 1, Reading = false) =>
{
	const Root = document.body.createDiv({ cls: "codex-sidebar" }); Root.style.cssText = "width:320px;height:480px";
	const List = Root.createDiv({ cls: "codex-messages" });
	const Messages = Array.from({ length: HistoryCount }, (_, Index) => ({ Id: "old-" + Index, Role: "assistant", TurnId: "old-turn-" + Index, Text: ("原创讲解: 先写交换子的定义, 再代入矩阵相乘. ").repeat(25) }));
	Messages.push({ Id: "stream", Role: "assistant", TurnId: "turn", Text: "现在展开下一步." });
	const Owner = { Session: { Id: "session", Messages }, Capture: { LastView: null }, Busy: true, refresh: () => {} };
	const View = new Sidebar.CodexView({}, Owner); View.MessagesElement = List; View.Opened = true;
	await View.render_messages(); List.scrollTop = List.scrollHeight;
	const History = List.firstElementChild, BeforeHeight = List.scrollHeight, Frames = [];
	const Selection = window.getSelection(), Range = document.createRange(); Range.selectNodeContents(History.querySelector("p")); Selection.removeAllRanges(); Selection.addRange(Range);
	const Selected = Selection.toString();
	const ReadingTop = Reading === "near" ? List.scrollHeight - List.clientHeight - 20 : 60;
	window.StreamHook = async () => { if(Reading) { List.scrollTop = ReadingTop; List.dispatchEvent(new Event("scroll")); } };
	let Done = false;
	const Observe = () => { Frames.push({ height: List.scrollHeight, top: List.scrollTop }); if(!Done) { requestAnimationFrame(Observe); } };
	requestAnimationFrame(Observe);
	window.RenderCalls = 0; Messages.at(-1).Text += " 对于矩阵 $H,E$, 计算 $HE-EH$.";
	await View.render_messages();
	Done = true; await new Promise(Resolve => requestAnimationFrame(Resolve));
	const Result = { historyCount: HistoryCount, reading: Reading, beforeHeight: BeforeHeight, minimumHeight: Math.min(...Frames.map(Frame => Frame.height)), historyPreserved: List.firstElementChild === History, selectionPreserved: Selection.toString() === Selected, renderCalls: window.RenderCalls, readingPreserved: !Reading || Math.abs(List.scrollTop - ReadingTop) < 1, bottomGap: List.scrollHeight - List.clientHeight - List.scrollTop, frames: Frames };
	window.StreamHook = null;
	List.lastElementChild.querySelector('.codex-message-body').createEl('p',{text:'迟到的公式排版行. '.repeat(40)});
	await new Promise(Resolve => setTimeout(Resolve, 60));
	Result.lateLayoutPreserved = Reading ? Math.abs(List.scrollTop - ReadingTop) < 1 : List.scrollHeight - List.clientHeight - List.scrollTop < 2;
	View.MessageList?.dispose(); Root.remove(); Selection.removeAllRanges(); return Result;
};

window.run_context_case = async () =>
{
	const Root = document.body.createDiv({cls:'codex-sidebar'}), Context = Root.createDiv({cls:'codex-context'});
	const Snapshot = {Path:'Original.md',Kind:'选区',Mode:'阅读',Mapping:'源块',CapturedAt:'original-time',Text:'原创段落 $x=1$.',LineStart:0,LineEnd:0,Heading:'定义',Truncated:false};
	const Owner = {Session:{Id:'session',Title:'original',Messages:[]},Capture:{Snapshot},State:{Settings:{AttachContext:true},Sessions:[]},Busy:true,refresh:()=>{}};Owner.State.Sessions=[Owner.Session];
	const View = new Sidebar.CodexView({},Owner);View.Opened=true;View.Input={value:''};View.ContextElement=Context;View.SelectionPreview={update:()=>{}};
	View.StatusElement=Root.createDiv();
	View.NoteSessionBind=Root.createEl('button');View.SessionsElement=Root.createEl('select');
	for(const Method of ['refresh_controls','refresh_completion','refresh_quote','refresh_activity'])View[Method]=()=>{};
	try{
		View.refresh();const Details=Context.querySelector('details');Details.open=true;const Checkbox=Context.querySelector('input');
		View.refresh();Owner.State.Settings.AttachContext=false;View.refresh();
		const Result={detailsPreserved:Details===Context.querySelector('details')&&Details.open,checkboxPreserved:Checkbox===Context.querySelector('input'),checkboxUpdated:Context.querySelector('input').checked===false};
		await View.onClose();View.ContextElement=Root.createDiv({cls:'codex-context'});View.Opened=true;View.refresh();
		Result.reopenedRestored=!!View.ContextElement.querySelector('details')&&View.ContextElement.querySelector('input').checked===false;
		return Result;
	}finally{clearTimeout(View.RenderTimer);View.Opened=false;Root.remove();}
};

window.run_followup_case = async () =>
{
	const Root = document.body.createDiv({cls:'codex-sidebar'}); Root.style.cssText='width:420px;height:480px';
	const Messages = [{Id:'root-explanation',Role:'assistant',Text:'原创完整说明: 固定 X, 分别核对交换子对加法与数乘的分配律.'}];
	for(let I=0;I<82;I++)Messages.push({Id:'middle-'+I,Role:'assistant',Text:'中间的另一段原创说明 '+I});
	for(let I=1;I<=3;I++)Messages.push({Id:'followup-u'+I,Role:'user',TurnId:'followup-t'+I,Text:'展开这一步',Quote:{SessionId:'followup-session',MessageId:I===1?'root-explanation':'followup-a'+(I-1),RootMessageId:'root-explanation',SelectedText:'分配律',SourceText:'固定 X, 核对分配律.',SelectedTruncated:false,SourceTruncated:false}},{Id:'followup-a'+I,Role:'assistant',TurnId:'followup-t'+I,Text:'第'+I+'次整合说明: '+('先展开乘法, 再合并各项. ').repeat(3)});
	const Before=JSON.stringify(Messages), Owner={Session:{Id:'followup-session',Messages},Capture:{LastView:null},Busy:false,refresh:()=>{}};
	const View=new Sidebar.CodexView({},Owner);View.MessagesElement=Root.createDiv({cls:'codex-messages'});View.Opened=true;
	const Wait=async Id=>{for(let I=0;I<200;I++){if(!View.Rendering&&Root.querySelector('[data-message-id="'+Id+'"]'))return true;await new Promise(R=>setTimeout(R,10));}return false;};
	try
	{
		await View.render_messages();const ColdBounded=Root.querySelectorAll('[data-message-id]').length===40&&!Root.querySelector('[data-message-id="root-explanation"]');
		const Latest=Root.querySelector('[data-message-id="followup-a3"]'),Buttons=[...Latest.querySelectorAll('.codex-followup-chain button')];
		const HasRootAndParent=Buttons.some(B=>B.textContent==='原始说明')&&Buttons.some(B=>B.textContent==='上次引用的回答');
		Buttons.find(B=>B.textContent==='原始说明').click();const OriginalLoaded=await Wait('root-explanation');
		const Original=Root.querySelector('[data-message-id="root-explanation"]'), LatestLink=[...Original.querySelectorAll('.codex-followup-chain button')].find(B=>B.textContent==='最新整合说明');
		LatestLink.click();const LatestLoaded=await Wait('followup-a3');
		return {coldBounded:ColdBounded,hasRootAndParent:HasRootAndParent,originalLoaded:OriginalLoaded,latestLoaded:LatestLoaded,allOldRecordsPreserved:JSON.stringify(Messages)===Before};
	}
	finally {View.Opened=false;clearTimeout(View.RenderTimer);View.MessageList?.dispose();Root.remove();}
};

window.run_switch_case = async (CheckIsolation = false) =>
{
	const Root = document.body.createDiv({cls:'codex-sidebar'}); Root.style.cssText='width:420px;height:480px';
	const List = Root.createDiv({cls:'codex-messages'}), Count = 35;
	const A = {Id:'note-a',Messages:Array.from({length:Count},(_,I)=>({Id:'a-'+I,Role:'assistant',Text:'原创例子: 由 $[X,Y]=XY-YX$ 展开矩阵计算, 再分别检查加法与数乘. '.repeat(8)}))}, B = {Id:'note-b',Messages:[]};
	const Owner = {Session:A,Capture:{LastView:{file:{path:'A.md'}}},Busy:false,Remote:{Enabled:false,CacheId:'original-device'},refresh:()=>{}};
	const View = new Sidebar.CodexView({},Owner); View.MessagesElement=List; View.Opened=true;
	try
	{
		await View.render_messages(); List.scrollTop=80; List.dispatchEvent(new Event('scroll')); const Position=List.scrollTop, Cards=[...List.children];
		Owner.Session=B; Owner.Capture.LastView.file.path='B.md'; await View.render_messages();
		const Calls=window.RenderCalls, Started=performance.now(); Owner.Session=A; Owner.Capture.LastView.file.path='A.md'; await View.render_messages();
		const Result={historyCount:Count,returnMilliseconds:performance.now()-Started,returnRenderCalls:window.RenderCalls-Calls,cardsReused:Cards.every((E,I)=>List.children[I]===E),readingPreserved:Math.abs(List.scrollTop-Position)<1,sourcePathStable:true,devicesIsolated:true,desktopReturnsRetained:true};
		if(CheckIsolation)
		{
			const BeforePath=window.RenderCalls; Owner.Capture.LastView.file.path='Moved.md'; await View.render_messages(); Result.sourcePathStable=window.RenderCalls-BeforePath===0;
			const Desktop=List.firstElementChild; Owner.Remote.Enabled=true; await View.render_messages(); Result.devicesIsolated=List.firstElementChild!==Desktop;
			const BeforeReturn=window.RenderCalls; Owner.Remote.Enabled=false; await View.render_messages(); Result.desktopReturnsRetained=List.firstElementChild===Desktop&&window.RenderCalls===BeforeReturn;
		}
		return Result;
	}
	finally { View.Opened=false; clearTimeout(View.RenderTimer); View.MessageList?.dispose(); Root.remove(); }
};

window.run_cold_history_case = async () =>
{
	const Root = document.body.createDiv({cls:'codex-sidebar'});Root.style.cssText='width:420px;height:720px';
	const List=Root.createDiv({cls:'codex-messages'}), Count=240;
	const Messages=Array.from({length:Count/2},(_,I)=>[
		{Id:'q-'+I,Role:'user',TurnId:'t-'+I,Text:'原创问题: 展开交换子计算 '+I,Context:{Path:'A/Original.md',Mode:'阅读',Kind:'当前位置',Text:'先定义交换子 $[X,Y]=XY-YX$.',SelectedText:'',LineStart:0,LineEnd:0,Heading:'定义',Mapping:'源块',CapturedAt:'original-time',Truncated:false}},
		{Id:'r-'+I,Role:'assistant',TurnId:'t-'+I,Text:'原创解释: 将 $[X,Y]=XY-YX$ 展开, 然后分别验证加法和数乘. '.repeat(3),CompletionStatus:'completed'}]).flat();
	const Session={Id:'cold-session',Title:'Original',Messages},Owner={Session,Capture:{LastView:{file:{path:'A/Original.md'}}},Busy:false,Remote:{Enabled:false,CacheId:'original-device'},refresh:()=>{}};
	const View=new Sidebar.CodexView({},Owner);View.MessagesElement=List;View.Opened=true;
	let Cards=0;const Render=View.render_card.bind(View);View.render_card=(...Args)=>{Cards++;return Render(...Args);};
	try
	{
		window.RenderCalls=0;window.RenderPaths=[];const Started=performance.now();await View.render_messages();await new Promise(R=>requestAnimationFrame(R));
		const First={milliseconds:performance.now()-Started,cardRenders:Cards,markdownRenders:window.RenderCalls,cards:List.querySelectorAll('.codex-message').length,domElements:List.querySelectorAll('*').length};
		const Last=List.querySelector('[data-message-id="r-119"]'),MathBody=Last.querySelector('.codex-message-body');List.scrollTop=50;List.dispatchEvent(new Event('scroll'));const Top=List.scrollTop;
		Owner.Capture.LastView.file.path='B/SameName.md';const Before=Cards;await View.render_messages();
		const FocusStable=Cards===Before&&List.querySelector('[data-message-id="r-119"]')===Last;
		const HasEarlier=!!List.querySelector('.codex-history-load');let EarlierAdded=false,OlderAnchorRetained=false,SourcePathCorrect=window.RenderPaths.slice(0,First.markdownRenders).every(P=>P==='A/Original.md');
		if(HasEarlier)
		{
			List.querySelector('.codex-history-load button').click();await new Promise(R=>setTimeout(R,0));await View.render_messages();
			EarlierAdded=List.querySelectorAll('.codex-message').length===80;OlderAnchorRetained=List.querySelector('[data-message-id="r-119"]')===Last&&Last.querySelector('.codex-message-body')===MathBody;
		}
		return {totalMessages:Count,first:First,focusStable:FocusStable,stableSourcePath:SourcePathCorrect,loadEarlierAvailable:HasEarlier,earlierAdded:EarlierAdded,olderCardsRetained:OlderAnchorRetained,savedMessagesEqual:Session.Messages.length===Count};
	}
	finally{View.Opened=false;clearTimeout(View.RenderTimer);View.MessageList?.dispose();Root.remove();}
};
