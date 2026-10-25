class Component { load() {} unload() {} registerDomEvent() {} }
class ItemView extends Component { constructor() { super(); this.app = {}; } }
const Define = () => ({});
window.RenderCalls = 0;
window.require = Name =>
{
	if(Name === "obsidian")
	{
		return { Component, ItemView, Plugin: Component, PluginSettingTab: Component, Modal: Component, MarkdownView: Component, Notice: Component, Platform: { isMobile: false }, MarkdownRenderer: { render: async (_App, Text, Body) => { window.RenderCalls++; await new Promise(Resolve => setTimeout(Resolve, 18)); Body.createEl("p", { text: Text }); if(Text.startsWith("现在展开")) { await window.StreamHook?.(Body); } } } };
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
	const View = new Sidebar.CodexView({}, Owner); View.contentEl = Root; View.app = { vault: { getName: () => "disposable-sidebar-fixture" } };
	try
	{
		await View.onOpen();
		const Text = Root.textContent;
		const RetiredAbsent = !Root.querySelector('.codex-note-session-status,.codex-note-session-toggle,.codex-edit-options,.codex-study-container') && !/随笔记切换会话|修改范围|数学学习工作台|笔记对应会话/.test(Text);
		View.Input.value = "修改选中的一段"; await View.send_input("edit");
		Owner.State.Settings.EditScope = "note"; View.Input.value = "修改当前笔记"; await View.send_input("edit");
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
		return { retiredAbsent: RetiredAbsent, actionsRetained: Actions.join('|') === '提问|生成修改预览|停止', questionAndPreviewKeepSavedScope: Calls.length === 2 && Calls[0][3].Scope === 'captured' && Calls[1][3].Scope === 'note' && Calls.every(Value => Value[3].Mode === 'edit' && Value[3].Role === 'auto'), ordinaryAnswerQuoted: OrdinaryAnswerQuoted, editUiExcluded: EditUiExcluded, noOwnHover: Root.querySelectorAll('[title],[aria-label]').length === 0 };
	}
	finally { await View.onClose(); if(!Keep) { Root.remove(); } }
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
