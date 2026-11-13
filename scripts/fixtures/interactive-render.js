// SDK boundary only. CodexView, protocol, panel, plotting, quoting and storage are production imports.
(() =>
{
	const BaseRequire = window.require;
	window.InteractiveEvidence = { notices: [], clipboard: [], requests: [], renders: [], errors: [], registered: 0, disposed: 0 };
	const Evidence = window.InteractiveEvidence;
	class Component
	{
		constructor() { this.Cleanups = []; }
		load() { this.Loaded = true; }
		register(Callback) { this.Cleanups.push(Callback); Evidence.registered++; }
		registerDomEvent(Target, Type, Callback, Options)
		{
			Target.addEventListener(Type, Callback, Options);
			this.register(() => Target.removeEventListener(Type, Callback, Options));
		}
		unload()
		{
			for(const Cleanup of this.Cleanups.splice(0).reverse()) { Cleanup(); Evidence.disposed++; }
			this.Loaded = false;
		}
	}
	class ItemView extends Component { constructor() { super(); this.app = {}; } }
	class Notice { constructor(Text) { Evidence.notices.push(String(Text)); } }
	const Platform = { isMobile: false };
	window.InteractiveRenderGate = null;
	window.InteractiveMathMetadata = true;
	function inline(Text, Root)
	{
		for(const Part of Text.split(/(\$[^$\n]+\$)/g))
		{
			if(Part.startsWith('$') && Part.endsWith('$'))
			{
				const Span = Root.createSpan({cls:'math-inline'});
				const Container = Span.createEl('mjx-container'), Math = Container.createEl('mjx-math');
				if(window.InteractiveMathMetadata) { Math.setAttribute('data-latex', Part.slice(1, -1)); }
				Math.textContent = Part.slice(1, -1);
			}
			else { Root.append(document.createTextNode(Part)); }
		}
	}
	// Deliberately limited SDK renderer for the authored fixture: no UI parsing or source-offset logic.
	const MarkdownRenderer = { render: async (_App, Text, Root, Path) =>
	{
		Evidence.renders.push({ text: Text, path: Path });
		const Gate = window.InteractiveRenderGate;
		if(Gate && Gate.Text === Text) { Gate.Started = true; await Gate.Promise; }
		await new Promise(Resolve => setTimeout(Resolve, 1));
		const Lines = Text.split('\n');
		for(let Index = 0; Index < Lines.length;)
		{
			if(!Lines[Index].trim()) { Index++; continue; }
			if(Lines[Index].startsWith('```'))
			{
				const Language = Lines[Index++].slice(3), Code = [];
				while(Index < Lines.length && Lines[Index] !== '```') { Code.push(Lines[Index++]); }
				if(Index < Lines.length) { Index++; }
				Root.createEl('pre').createEl('code', {cls:'language-' + Language, text:Code.join('\n')});
			}
			else if(/^#{1,6} /.test(Lines[Index]))
			{
				const Heading = Lines[Index++].match(/^(#{1,6}) (.*)$/); inline(Heading[2], Root.createEl('h' + Heading[1].length));
			}
			else if(Lines[Index] === '$$')
			{
				Index++; const Math = [];
				while(Index < Lines.length && Lines[Index] !== '$$') { Math.push(Lines[Index++]); }
				Index++; Root.createDiv({cls:'math-block', text:Math.join('\n')});
			}
			else
			{
				const Paragraph = [];
				while(Index < Lines.length && Lines[Index].trim()) { Paragraph.push(Lines[Index++]); }
				inline(Paragraph.join('\n'), Root.createEl('p'));
			}
		}
	} };
	window.require = Name => Name === 'obsidian' ? { ...BaseRequire(Name), Component, ItemView, Notice, Platform, MarkdownRenderer } : BaseRequire(Name);
	Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async Text => { Evidence.clipboard.push(Text); }} });
	for(const Name of ['fetch', 'WebSocket', 'EventSource'])
	{
		window[Name] = function(...Args) { Evidence.requests.push({api:Name, target:String(Args[0])}); throw Error('Network is forbidden in the interactive fixture'); };
	}
	XMLHttpRequest.prototype.open = function(Method, Url) { Evidence.requests.push({api:'XMLHttpRequest', target:String(Url), method:Method}); throw Error('Network is forbidden in the interactive fixture'); };
	navigator.sendBeacon = Url => { Evidence.requests.push({api:'sendBeacon', target:String(Url)}); return false; };
	window.addEventListener('error', Event => Evidence.errors.push(Event.message));
	window.addEventListener('unhandledrejection', Event => Evidence.errors.push(String(Event.reason?.stack ?? Event.reason)));
	window.InteractivePlatform = Platform;
})();

(() =>
{
	const Note = '---\ntitle: 原创热方程示例\n---\n\n# 参数的意义\n\n设 $t\\ge0$. 时间参数只改变衰减，空间区间为 $0\\le x\\le\\pi$.\n\n振幅参数由初值给定。';
	const Context = {Path:'原创夹具/热方程.md', Kind:'当前位置', Mode:'阅读', Mapping:'源文本', CapturedAt:'2026-11-13T00:00:00Z', Text:Note, SelectedText:'', LineStart:0, LineEnd:8, Heading:'参数的意义', Truncated:false};
	const Spec = {schemaVersion:1, plots:[{id:'heat', title:'热方程的时间衰减', expression:'a*exp(-t)*sin(x)', x:{min:0,max:Math.PI}, y:{min:-2,max:2}, parameters:[{name:'t',label:'时间',min:0,max:5,step:0.1,value:0},{name:'a',label:'初始振幅',min:-2,max:2,step:0.1,value:1}], caption:'固定区间与纵轴，比较同一振型在不同时刻的振幅。'}], symbols:[{id:'time',symbol:'$t$',meaning:'时间参数，决定振幅的指数衰减。',conditions:'要求 $t\\ge0$；保持空间区间及边界条件不变。',quote:'设 $t\\ge0$.'},{id:'amplitude',symbol:'$a$',meaning:'初始振幅，正负号改变曲线方向。',conditions:'本例 $-2\\le a\\le2$，不是一般定理的范围。'}]};
	const Before = '# 一个热方程振型\n\n考虑齐次 Dirichlet 边界，初值为正弦振型。令 $t$ 表示时间，$a$ 表示初始振幅。\n\n$$\nu(x,t)=a e^{-t}\\sin x.\n$$\n\n直接计算可得时间导数与二阶空间导数相同；两端的正弦值为零。';
	const After = '这段在交互数据之后，仍属于完整原创回答。它说明边界始终为零，参数调整不改变证明或初始条件的含义。';
	const Text = Before + '\n\n```codex-ui\n' + JSON.stringify(Spec, null, 2) + '\n```\n\n' + After;
	const tick = () => new Promise(Resolve => setTimeout(Resolve, 15));
	const equal = (A, B) => JSON.stringify(A) === JSON.stringify(B);
	const stored = () => Object.fromEntries(Object.keys(localStorage).filter(Key => Key.startsWith('codex-sidebar-interactive:')).map(Key => [Key,localStorage.getItem(Key)]));
	function check(Name, Passed, Detail = {}) { window.InteractiveCase.Checks.push({name:Name, passed:!!Passed, ...Detail}); }
	function require_element(Selector, Root = window.InteractiveCase.Root)
	{
		const Result = Root.querySelector(Selector); if(!Result) { throw Error('Missing ' + Selector); } return Result;
	}
	function card() { return require_element('[data-message-id="answer"]'); }
	function panel() { return require_element('.codex-interactive', card()); }
	function slider(Name = 't') { return require_element('input[id$="-' + Name + '"]', panel()); }
	function value(Name = 't') { return Number(slider(Name).value); }
	function input_value(Value, Name = 't') { const Input = slider(Name); Input.value = String(Value); Input.dispatchEvent(new Event('input',{bubbles:true})); }
	async function settle()
	{
		const {View} = window.InteractiveCase;
		for(let Index = 0; Index < 200; Index++)
		{
			if(!View.Rendering) { await View.render_messages(); if(!View.Rendering) { await tick(); return; } }
			await tick();
		}
		throw Error('CodexView render did not settle');
	}
	function clear_draft()
	{
		const {View, Owner} = window.InteractiveCase;
		View.Input.value = ''; Owner.AnswerQuote = null; View.SelectedAnswer = null;
		View.Input.dispatchEvent(new Event('input',{bubbles:true})); View.refresh();
	}
	function symbol_button(Id) { return [...panel().querySelectorAll('.codex-symbol-choice')][Id]; }
	async function choose(Id)
	{
		symbol_button(Id).click();
		for(let Index = 0; Index < 100; Index++)
		{
			if(panel().querySelector('.codex-symbol-meaning')?.textContent === Spec.symbols[Id].meaning) { return; }
			await tick();
		}
		throw Error('Symbol selection did not settle: ' + Id);
	}
	function gate(Text)
	{
		let Release; const Gate = {Text, Started:false, Promise:new Promise(Resolve => { Release = Resolve; })};
		window.InteractiveRenderGate = Gate;
		return { Gate, release:() => { window.InteractiveRenderGate = null; Release(); } };
	}
	async function started(Gate)
	{
		for(let Index = 0; Index < 100 && !Gate.Started; Index++) { await tick(); }
		if(!Gate.Started) { throw Error('Deferred SDK render was not reached'); }
	}

	window.start_interactive_case = async ({Width = 320, Theme = 'theme-dark', Mobile = false, Scope = 'interactive-' + crypto.randomUUID(), MathMetadata = true} = {}) =>
	{
		if(window.InteractiveCase) { await window.close_interactive_case(); }
		document.body.className = Theme + (Mobile ? ' is-mobile is-tablet' : '');
		window.InteractivePlatform.isMobile = Mobile; window.InteractiveMathMetadata = MathMetadata;
		const Root = document.body.createDiv(); Root.id = 'interactive-sidebar-fixture'; Root.style.cssText = `width:${Width}px;height:820px`;
		const session = Id => ({Id,Title:'热方程 · ' + Id,Messages:[{Id:'question',Role:'user',TurnId:'turn',Text:'请完整解释这个热方程振型。',Context:structuredClone(Context)},{Id:'answer',Role:'assistant',TurnId:'turn',Phase:'final_answer',CompletionStatus:'completed',Text}]});
		const A = session('session-a'), B = session('session-b');
		const Calls = [], Opened = [], Owner = {Session:A, State:{Sessions:[A,B],Settings:{EditScope:'captured',AttachContext:true,Model:'fixture-model',Effort:'high',Fast:false,Completion:true,ShowUsage:false}},Capture:{Snapshot:null,LastView:null},Models:[{model:'fixture-model',displayName:'离线验收模型',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],Inline:{get_suggestion:()=>null},Status:'离线 UI 验收',SkillStatus:'math-writing',CatalogError:'',Busy:false,BackendSaveBlocked:false,AnswerQuote:null,Remote:{Enabled:false,CacheId:'fixture-other-device'},draft_scope:()=>window.InteractiveCase.Scope,persist:async()=>{},can_capture_pdf_box:()=>false,clear_context(){ this.Capture.Snapshot = null; },async send_chat(...Args){ Calls.push(Args); throw Error('Unexpected inference submission'); },refresh:()=>{}};
		const File = {path:Context.Path,extension:'md',stat:{size:Note.length}};
		const App = {vault:{getName:()=>'disposable-interactive-fixture',getFileByPath:Path=>Path===File.path?File:null,cachedRead:async()=>Note},workspace:{getLeavesOfType:()=>[],getLeaf:()=>({openFile:async(File, Options)=>{ Opened.push({path:File.path,options:Options}); }})}};
		const View = new Sidebar.CodexView({}, Owner); View.contentEl = Root; View.app = App;
		window.InteractiveCase = {Root,View,Owner,A,B,Scope,OriginalScope:Scope,Calls,Opened,Checks:[],BeforeMessages:JSON.stringify([A,B]),OriginalText:Text};
		Owner.refresh = () => View.refresh();
		View.load(); await View.onOpen(); await settle();
		const Body = require_element('.codex-message-body', card());
		check('actual-view-answer-panel', Root.classList.contains('codex-sidebar') && !!View.MessageList && !!panel().querySelector('.codex-plot-svg'));
		check('complete-original-answer-retained', Body.querySelector('h1')?.textContent === '一个热方程振型' && Body.textContent.includes(After) && Owner.Session.Messages[1].Text === Text);
		check('validated-code-hidden-after-binding', Body.querySelector('pre')?.hidden && Body.querySelector('pre').hasAttribute('data-codex-answer-block') && panel().querySelector('.codex-interactive-raw pre')?.textContent === JSON.stringify(Spec,null,2));
		check('source-snapshot-keeps-note-frontmatter', Owner.Session.Messages[0].Context.Text.startsWith('---\n') && !Text.startsWith('---\n'));
		window.InteractiveCase.InitialSvg = require_element('.codex-plot-svg', panel());
		window.InteractiveCase.InitialPath = require_element('.codex-plot-path', panel()).getAttribute('d');
		window.InteractiveCase.InitialRenders = window.InteractiveEvidence.renders.length;
		window.InteractiveCase.InitialRequests = window.InteractiveEvidence.requests.length;
		return window.interactive_drag_position();
	};

	window.interactive_drag_position = () =>
	{
		slider().scrollIntoView({block:'center'});
		const Bounds = slider().getBoundingClientRect();
		return {x:Bounds.left + 8,y:Bounds.top + Bounds.height/2,toX:Bounds.left + 8 + (Bounds.width - 16)*0.46, width:Bounds.width, value:value()};
	};

	window.exercise_interactive_case = async () =>
	{
		const C = window.InteractiveCase, {View,Owner,Root} = C, E = window.InteractiveEvidence;
		const Svg = C.InitialSvg, Path = require_element('.codex-plot-path', panel());
		check('browser-native-slider-drag', value() > 0 && Path.getAttribute('d') !== C.InitialPath,{value:value()});
		check('drag-keeps-svg-and-markdown', Svg === require_element('.codex-plot-svg',panel()) && E.renders.length === C.InitialRenders);
		require_element('.codex-plot-reset',panel()).click();
		check('reset-without-svg-rebuild', value() === 0 && value('a') === 1 && Path.getAttribute('d') === C.InitialPath && require_element('.codex-plot-svg',panel()) === Svg && E.renders.length === C.InitialRenders);
		input_value(2); input_value(1.5,'a');
		check('local-parameter-output-and-no-network', require_element('input[id$="-t"]',panel()).getAttribute('aria-valuetext') === '2' && panel().querySelector('output').textContent === '2' && E.requests.length === C.InitialRequests && C.Calls.length === 0);
		check('symbol-meaning-and-conditions', panel().querySelector('.codex-symbol-meaning')?.textContent === Spec.symbols[0].meaning && !!panel().querySelector('.codex-symbol-conditions .math-inline'));
		const Open = require_element('.codex-symbol-open',panel()); Open.click();
		for(let Index = 0; Index < 100 && !C.Opened.length; Index++) { await tick(); }
		check('source-button-actual-navigation', C.Opened.length === 1 && C.Opened[0].path === Context.Path && C.Opened[0].options.eState.line === Note.slice(0,Note.indexOf(Spec.symbols[0].quote)).split('\n').length-1,{opened:C.Opened});
		await choose(1);
		check('unverified-symbol-has-no-source-button', !panel().querySelector('.codex-symbol-open') && panel().querySelector('.codex-symbol-origin').textContent.includes('来源未核验'));
		await choose(0);
		const Body = require_element('.codex-message-body',card()), Inline = [...Body.querySelectorAll('.math-inline')].find(Element=>Element.querySelector('mjx-math')?.getAttribute('data-latex') === 'a');
		check('inline-exact-tex-accessible', !!Inline?.classList.contains('codex-symbol-inline') && Inline.getAttribute('role') === 'button' && Inline.tabIndex === 0 && !!document.getElementById(Inline.getAttribute('aria-controls')));
		Inline.click(); await choose_wait(1);
		check('inline-click-opens-symbol-detail', symbol_button(1).getAttribute('aria-pressed') === 'true' && !!panel().querySelector('.codex-symbol-back'));
		require_element('.codex-symbol-back',panel()).click(); check('inline-return-restores-focus', document.activeElement === Inline);
		await choose(0);
		const Selection = window.getSelection(), Range = document.createRange(); Range.selectNodeContents(Inline); Selection.removeAllRanges(); Selection.addRange(Range);
		Inline.click(); await tick();
		check('selecting-original-math-does-not-open-detail', symbol_button(0).getAttribute('aria-pressed') === 'true'); Selection.removeAllRanges();
		for(const Key of ['Enter',' '])
		{
			await choose(0); const Event = new KeyboardEvent('keydown',{key:Key,bubbles:true,cancelable:true}); Inline.dispatchEvent(Event); await choose_wait(1);
			check('inline-keyboard-' + (Key === ' ' ? 'space' : 'enter'), Event.defaultPrevented && symbol_button(1).getAttribute('aria-pressed') === 'true');
		}
		// Select a paragraph after the hidden fence, through the actual CodexView selection/quote path.
		const Tail = [...Body.querySelectorAll(':scope > p')].find(Element=>Element.textContent === After), Offset = Text.indexOf(After);
		check('post-fence-source-block-offset', Number(Tail.dataset.codexAnswerFrom) === Offset && Text.slice(Number(Tail.dataset.codexAnswerFrom), Number(Tail.dataset.codexAnswerTo)).trim() === After,{expected:Offset,actual:Number(Tail.dataset.codexAnswerFrom)});
		Range.selectNodeContents(Tail); Selection.addRange(Range); View.capture_answer_selection();
		check('post-fence-original-selection', View.SelectedAnswer?.Mapping === 'source-blocks' && View.SelectedAnswer?.SelectedBlocks?.From === Offset && View.SelectedAnswer.SourceText === Text);
		const QuoteButton = [...View.QuoteElement.querySelectorAll('button')].find(Button=>Button.textContent==='追问这段');
		if(!QuoteButton) { throw Error('Actual original-answer quote action missing'); } QuoteButton.click();
		check('post-fence-followup-retains-full-answer', Owner.AnswerQuote?.SourceText === Text && Owner.AnswerQuote?.SelectedText === After && C.Calls.length === 0);
		Selection.removeAllRanges(); clear_draft();
		require_element('.codex-interactive-plot .codex-interactive-followup',panel()).click(); await settle();
		const Draft = View.Input.value, Quote = structuredClone(Owner.AnswerQuote), Refs = Sidebar.answer_sources(C.A.Messages,C.A.Messages[1]);
		check('parameter-followup-is-unsent-draft', Draft.includes('"t":2') && Draft.includes('"a":1.5') && Draft.includes(Spec.plots[0].expression) && C.Calls.length === 0 && document.activeElement === View.Input);
		check('parameter-followup-immutable-source-and-refs', Quote?.SourceText === Text && Quote?.SourceStatus === 'completed' && Quote?.SessionId === C.A.Id && Quote?.MessageId === 'answer' && Quote?.SourcePath === Context.Path && equal(Quote?.SourceReferences,Refs));
		require_element('.codex-interactive-plot .codex-interactive-followup',panel()).click();
		check('existing-quoted-draft-not-overwritten', View.Input.value === Draft && equal(Owner.AnswerQuote,Quote));
		clear_draft(); View.Input.value = '已有原创草稿，不可替换。'; View.Input.dispatchEvent(new Event('input',{bubbles:true}));
		require_element('.codex-interactive-plot .codex-interactive-followup',panel()).click();
		check('existing-plain-draft-not-overwritten', View.Input.value === '已有原创草稿，不可替换。' && !Owner.AnswerQuote);
		clear_draft(); Owner.BackendSaveBlocked = true; require_element('.codex-interactive-plot .codex-interactive-followup',panel()).click();
		check('unsaved-result-blocks-followup', !View.Input.value && !Owner.AnswerQuote && C.Calls.length === 0); Owner.BackendSaveBlocked = false;
		await choose(0); require_element('.codex-symbol-detail .codex-interactive-followup',panel()).click();
		check('symbol-followup-is-unsent-with-original-source', View.Input.value.includes(Spec.symbols[0].symbol) && Owner.AnswerQuote?.SourceText === Text && equal(Owner.AnswerQuote.SourceReferences,Refs) && C.Calls.length === 0); clear_draft();
		// Complete an older SDK render after a newer selection: production panel must reject it.
		const Deferred = gate(Spec.symbols[1].meaning); symbol_button(1).click(); await started(Deferred.Gate); await choose(0); Deferred.release(); await tick(); await tick();
		check('late-symbol-render-does-not-replace-new-choice', panel().querySelector('.codex-symbol-meaning').textContent === Spec.symbols[0].meaning && symbol_button(0).getAttribute('aria-pressed') === 'true');
		// Switch without refreshing first, so stale still-mounted DOM events really reach Active guards.
		for(const Kind of ['session','scope'])
		{
			input_value(2); input_value(1.5,'a'); await choose(0);
			const OldPanel = panel(), OldInput = slider(), OldDetail = require_element('.codex-symbol-detail',OldPanel), OldPath = require_element('.codex-plot-path',OldPanel), OldCurve = OldPath.getAttribute('d'), Delayed = gate(Spec.symbols[1].meaning);
			symbol_button(1).click(); await started(Delayed.Gate);
			if(Kind === 'session') { Owner.Session = C.B; } else { C.Scope = C.OriginalScope + '-other'; Owner.Remote.Enabled = true; }
			const Saved = JSON.stringify(stored()), OpenCount = C.Opened.length, CopyCount = E.clipboard.length;
			OldInput.value = '4'; OldInput.dispatchEvent(new Event('input',{bubbles:true}));
			check('late-' + Kind + '-slider-does-not-mutate-cached-svg', OldPath.getAttribute('d') === OldCurve);
			OldPanel.querySelector('.codex-plot-reset').click();
			check('late-' + Kind + '-reset-does-not-mutate-cached-svg', OldPath.getAttribute('d') === OldCurve);
			OldInput.value = '4'; OldInput.dispatchEvent(new Event('input',{bubbles:true}));
			for(const Selector of ['.codex-interactive-followup','.codex-symbol-open','.codex-interactive-copy']) { OldPanel.querySelector(Selector)?.click(); }
			Delayed.release(); await tick(); await tick();
			check('late-' + Kind + '-events-are-inert', JSON.stringify(stored()) === Saved && C.Opened.length === OpenCount && E.clipboard.length === CopyCount && !Owner.AnswerQuote && !View.Input.value && OldDetail.querySelector('.codex-symbol-meaning').textContent === Spec.symbols[0].meaning);
			View.refresh(); await settle();
			check(Kind + '-parameters-isolated', value() === 0 && value('a') === 1); input_value(3);
			Owner.Session = C.A; C.Scope = C.OriginalScope; Owner.Remote.Enabled = false; View.refresh(); await settle();
			check(Kind + '-A-B-A-restores-parameters', value() === 2 && value('a') === 1.5,{t:value(),a:value('a')});
			// A cached old chart may have received the late DOM event; readback must agree with persisted parameters.
		}
		await choose(0); input_value(2.3); input_value(1.5,'a'); await choose(1);
		const OldPanel = panel(), OldInline = [...require_element('.codex-message-body',card()).querySelectorAll('.codex-symbol-inline')][0], OldSvg = require_element('.codex-plot-svg',OldPanel), OldSlider = slider(), OldPath = require_element('.codex-plot-path',OldPanel), OldData = OldPath.getAttribute('d');
		await View.onClose(); View.unload();
		const BeforeClosedEvents = JSON.stringify(stored()); OldSlider.value = '4'; OldSlider.dispatchEvent(new Event('input')); OldInline.click(); OldInline.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true})); OldPanel.querySelector('.codex-interactive-copy').click();
		check('component-unload-cleans-inline-and-controls', !OldInline.classList.contains('codex-symbol-inline') && !OldInline.hasAttribute('role') && !OldInline.hasAttribute('tabindex') && !OldInline.hasAttribute('aria-controls') && !OldPanel.isConnected && OldPath.getAttribute('d') === OldData && JSON.stringify(stored()) === BeforeClosedEvents);
		View.load(); await View.onOpen(); await settle();
		check('view-reopen-restores-local-parameters-and-symbol', value() === 2.3 && value('a') === 1.5 && symbol_button(1).getAttribute('aria-pressed') === 'true' && require_element('.codex-plot-svg',panel()) !== OldSvg);
		require_element('.codex-interactive-copy',panel()).click(); await tick();
		const Markdown = E.clipboard.at(-1);
		check('static-markdown-export-complete-with-current-values', Markdown?.startsWith(Before) && Markdown.includes(After) && Markdown.includes('"t":2.3') && Markdown.includes('"a":1.5') && Markdown.includes(Spec.symbols[0].meaning) && Markdown.includes(Spec.symbols[0].conditions) && !Markdown.includes('```codex-ui') && !Markdown.includes('<svg'));
		C.Export = Markdown;
		check('original-history-never-rewritten', JSON.stringify([C.A,C.B]) === C.BeforeMessages && C.Calls.length === 0 && !E.requests.length);
		return {checks:C.Checks, exportedMarkdown:Markdown, scope:C.Scope, storage:stored()};
	};

	async function choose_wait(Id)
	{
		for(let Index = 0; Index < 100; Index++)
		{
			if(panel().querySelector('.codex-symbol-meaning')?.textContent === Spec.symbols[Id].meaning) { return; } await tick();
		}
		throw Error('Inline symbol action did not settle');
	}

	window.exercise_interactive_fallbacks = async () =>
	{
		const C = window.InteractiveCase, {View, Owner} = C, Original = C.A.Messages[1];
		const Cases = [
			['streaming',Text,undefined,undefined,'pending'],
			['interrupted',Text,'interrupted',undefined,'pending'],
			['backend-partial',Text,'completed',{Text,Status:'partial',Metadata:{Reason:'fixture interruption',Submission:'submitted',Transport:'buffered'}},'pending'],
			['unknown-completion',Text,'unknown',undefined,'pending'],
			['commentary',Text,'completed',undefined,'pending','commentary'],
			['invalid-json',Before+'\n\n```codex-ui\nnot JSON\n```','completed',undefined,'invalid'],
			['truncated-fence',Text.slice(0,Text.indexOf('\n```\n\n')),'completed',undefined,'invalid'],
			['duplicate-fence',Text+'\n\n```codex-ui\n'+JSON.stringify(Spec)+'\n```','completed',undefined,'invalid'],
			['unsafe-expression',Text.replace('a*exp(-t)*sin(x)','fetch(x)'),'completed',undefined,'invalid'],
			['incomplete-json','解释保留。\n\n```codex-ui\n{"schemaVersion":1',undefined,undefined,'pending']
		];
		for(const [Name,Content,CompletionStatus,BackendResult,Expected,Phase='final_answer'] of Cases)
		{
			C.A.Messages[1] = {...Original,Text:Content,CompletionStatus,BackendResult,Phase}; View.history_changed(C.A.Id,['answer']); await View.render_messages(); await settle();
			const Output = Sidebar.interactive_output(Content,Phase !== 'commentary' && CompletionStatus === 'completed' && (!BackendResult || BackendResult.Status === 'completed'));
			const Section = card().querySelector('.codex-interactive');
			check('fallback-' + Name + '-has-no-operable-ui', Output.Status === Expected && !!Section?.querySelector('[role="status"]') && !Section.querySelector('button,input,svg,[role="button"]') && !card().querySelector('.codex-symbol-inline') && card().querySelector('.codex-message-body').textContent.includes(Content.includes('not JSON')?'not JSON':Content.startsWith(Before)?'一个热方程振型':'解释保留。'),{protocol:Output.Status});
		}
		C.A.Messages[1] = Original; View.history_changed(C.A.Id,['answer']); window.InteractiveMathMetadata = false; await View.render_messages(); await settle();
		check('no-tex-metadata-never-guesses-glyphs', !!card().querySelector('.math-inline mjx-math') && !card().querySelector('.codex-symbol-inline'));
		window.InteractiveMathMetadata = true;
		// Ambiguous TeX symbol names must not bind either original occurrence.
		const Ambiguous = structuredClone(Spec); Ambiguous.symbols[1].symbol = '$t$';
		C.A.Messages[1] = {...Original,Text:Text.replace(JSON.stringify(Spec,null,2),JSON.stringify(Ambiguous,null,2))}; View.history_changed(C.A.Id,['answer']); await View.render_messages(); await settle();
		check('duplicate-tex-symbol-never-binds-inline', !card().querySelector('.codex-symbol-inline'));
		C.A.Messages[1] = Original; View.history_changed(C.A.Id,['answer']); await View.render_messages(); await settle();
		return {checks:C.Checks};
	};

	window.interactive_screenshot_position = async (Symbols = false) =>
	{
		const Target = require_element(Symbols?'.codex-interactive-symbols':'.codex-plot',panel());
		const List = require_element('.codex-messages');
		List.scrollTop += Target.getBoundingClientRect().top - List.getBoundingClientRect().top - 12;
		await tick();
		const Bounds = panel().getBoundingClientRect(), Failures = [];
		for(const Element of panel().querySelectorAll('button,input,svg.codex-plot-svg,.codex-symbol-detail'))
		{
			if(Element.closest('details:not([open])') || Element.hidden) { continue; }
			const Rect = Element.getBoundingClientRect();
			if(Rect.width && (Rect.left < Bounds.left - 1 || Rect.right > Bounds.right + 1 || Rect.width < 1)) { Failures.push({className:Element.getAttribute('class'),left:Rect.left,right:Rect.right,panel:[Bounds.left,Bounds.right]}); }
		}
		check(Symbols?'symbol-controls-fit-width':'plot-controls-fit-width', !Failures.length,{overflows:Failures});
		return {checks:window.InteractiveCase.Checks};
	};

	window.prepare_interactive_reload = async () =>
	{
		clear_draft(); input_value(2.3); input_value(1.5,'a'); await choose(1);
		require_element('.codex-interactive-plot .codex-interactive-followup',panel()).click(); await settle();
		const C = window.InteractiveCase;
		return {scope:C.Scope,t:value(),a:value('a'),symbol:'amplitude',draft:C.View.Input.value,quote:C.Owner.AnswerQuote};
	};
	window.verify_interactive_reload = async Expected =>
	{
		const C = window.InteractiveCase;
		check('page-reload-restores-parameters-symbol-and-draft', value() === Expected.t && value('a') === Expected.a && symbol_button(1).getAttribute('aria-pressed') === 'true' && C.View.Input.value === Expected.draft && equal(C.Owner.AnswerQuote,Expected.quote) && C.Calls.length === 0);
		return {checks:C.Checks,storage:stored()};
	};
	window.close_interactive_case = async () =>
	{
		const C = window.InteractiveCase; if(!C) { return; }
		await C.View.onClose(); C.View.unload(); C.Root.remove(); window.getSelection()?.removeAllRanges(); window.InteractiveCase = null;
	};
})();
