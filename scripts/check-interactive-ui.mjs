// node scripts/check-interactive-ui.mjs; requires CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS.
// Disposable Chrome/CDP origin, real CodexView + production interactive modules; never opens Obsidian.
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Directory = mkdtempSync(join(tmpdir(), 'codex-interactive-ui-'));
const Browser = process.env.CODEX_LAYOUT_BROWSER;
const AppCss = process.env.CODEX_LAYOUT_APP_CSS;
const Focus = process.env.CODEX_INTERACTIVE_FOCUS;
const Report = { directory:Directory, startedAt:new Date().toISOString(), tier:'actual CodexView + production panel/protocol/state/plot/symbols; SDK/Markdown/clipboard/vault boundaries simulated', boundaries:['No real inference, publication, deployment or daily Obsidian access','Chrome mobile/touch emulation, not iPad hardware or native MathJax validation','Authored Markdown subset renderer; synthetic MathJax exact data-latex metadata, not math typesetting','State is real localStorage in a unique disposable loopback origin and Chrome profile'], command:'node scripts/check-interactive-ui.mjs', browser:Browser, appCss:AppCss, surfaces:[], screenshots:[], failures:[], requests:[], browserErrors:[] };
const SourcePaths = ['src/view.ts','src/explanation-actions.ts','src/interactive/protocol.ts','src/interactive/panel.ts','src/interactive/state.ts','src/interactive/plot.ts','src/interactive/plot-view.ts','src/interactive/symbols.ts','src/interactive/structures.ts','src/interactive/structures-view.ts','src/interactive/symbol-view.ts','styles.css'];
const source_times = () => Object.fromEntries(SourcePaths.map(Path => [Path,statSync(join(Root,Path)).mtime.toISOString()]));
let Server, Child, Socket, Sequence = 0;
const Pending = new Map();
function call(Method, Params = {})
{
	return new Promise((Resolve, Reject) =>
	{
		const Id = ++Sequence, Timer = setTimeout(() => { Pending.delete(Id); Reject(Error('CDP timeout: ' + Method)); },60000);
		Pending.set(Id,{resolve:Value=>{ clearTimeout(Timer); Resolve(Value); },reject:ErrorValue=>{ clearTimeout(Timer); Reject(ErrorValue); }});
		Socket.send(JSON.stringify({id:Id,method:Method,params:Params}));
	});
}
async function evaluate(Expression)
{
	const Value = await call('Runtime.evaluate',{expression:Expression,awaitPromise:true,returnByValue:true});
	if(Value.exceptionDetails) { throw Error(Value.exceptionDetails.exception?.description ?? Value.exceptionDetails.text); }
	return Value.result.value;
}
async function ready()
{
	for(let Index = 0; Index < 120; Index++)
	{
		if(await evaluate('typeof window.start_interactive_case === "function" && typeof Sidebar === "object"')) { return; }
		await new Promise(Resolve=>setTimeout(Resolve,50));
	}
	throw Error('Fixture did not load');
}
async function emulate(Width, Mobile)
{
	await call('Emulation.setDeviceMetricsOverride',{width:Width,height:820,deviceScaleFactor:1,mobile:Mobile});
	await call('Emulation.setTouchEmulationEnabled',{enabled:Mobile,maxTouchPoints:Mobile?5:1});
}
async function drag(Position, Mobile)
{
	if(Mobile)
	{
		await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Position.x,y:Position.y,id:1}]});
		for(let Index = 1; Index <= 8; Index++) { await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Position.x+(Position.toX-Position.x)*Index/8,y:Position.y,id:1}]}); }
		await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
	}
	else
	{
		await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:Position.x,y:Position.y});
		await call('Input.dispatchMouseEvent',{type:'mousePressed',x:Position.x,y:Position.y,button:'left',clickCount:1});
		for(let Index = 1; Index <= 8; Index++) { await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:Position.x+(Position.toX-Position.x)*Index/8,y:Position.y,button:'left',buttons:1}); }
		await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:Position.toX,y:Position.y,button:'left',clickCount:1});
	}
}
async function screenshot(Name, Width)
{
	const Shot = await call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:Width,height:820,scale:1}});
	const Path = join(Directory,Name+'.png'); writeFileSync(Path,Buffer.from(Shot.data,'base64')); Report.screenshots.push(Path);
}

try
{
	if(!Browser || !AppCss) { throw Error('Set CODEX_LAYOUT_BROWSER and CODEX_LAYOUT_APP_CSS (browser executable and public Obsidian app.css)'); }
	statSync(Browser); // Fail before launching when the configured executable is missing.
	Report.sourceTimes = source_times();
	Report.gitHead = spawnSync('git',['rev-parse','HEAD'],{cwd:Root,encoding:'utf8',windowsHide:true}).stdout.trim();
	Report.gitStatus = spawnSync('git',['status','--short'],{cwd:Root,encoding:'utf8',windowsHide:true}).stdout.trim();
	await build({stdin:{contents:'export { CodexView } from "./view"; export { interactive_output } from "./interactive/protocol"; export { answer_sources } from "./sources";',resolveDir:join(Root,'src'),loader:'ts'},external:['obsidian','@codemirror/state','@codemirror/view','node:*'],bundle:true,platform:'browser',format:'iife',globalName:'Sidebar',outfile:join(Directory,'sidebar.js'),sourcemap:'inline'});
	const Assets = new Map([
		['/app.css',{type:'text/css',body:readFileSync(AppCss)}],
		['/plugin.css',{type:'text/css',body:readFileSync(join(Root,'styles.css'))}],
		['/sdk.js',{type:'text/javascript',body:readFileSync(join(Root,'scripts/fixtures/stream-render.js'))}],
		['/fixture.js',{type:'text/javascript',body:readFileSync(join(Root,'scripts/fixtures/interactive-render.js'))}],
		['/sidebar.js',{type:'text/javascript',body:readFileSync(join(Directory,'sidebar.js'))}]
	]);
	const Html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/plugin.css"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}body{background:var(--background-primary);color:var(--text-normal)}</style></head><body class="theme-dark"><script src="/sdk.js"></script><script src="/fixture.js"></script><script src="/sidebar.js"></script></body></html>';
	writeFileSync(join(Directory,'fixture.html'),Html);
	Server = createServer((Request,Response)=>
	{
		const Asset = Request.url === '/' ? {type:'text/html',body:Html} : Assets.get(Request.url);
		Response.writeHead(Asset?200:404,{'Content-Type':Asset?.type??'text/plain','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'",'Cache-Control':'no-store'});
		Response.end(Asset?.body??'Not found');
	});
	await new Promise(Resolve=>Server.listen(0,'127.0.0.1',Resolve));
	const Origin = 'http://127.0.0.1:'+Server.address().port; Report.origin = Origin;
	Child = spawn(Browser,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${join(Directory,'profile')}`,'--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
	let SpawnError; Child.on('error',ErrorValue=>{ SpawnError = ErrorValue; });
	let Port;
	for(let Index = 0; Index < 100; Index++)
	{
		if(SpawnError) { throw SpawnError; }
		try { Port = Number(readFileSync(join(Directory,'profile','DevToolsActivePort'),'utf8').split('\n')[0]); break; } catch { await new Promise(Resolve=>setTimeout(Resolve,100)); }
	}
	if(!Port) { throw Error('Chrome did not create DevToolsActivePort'); }
	const Pages = await (await fetch(`http://127.0.0.1:${Port}/json/list`)).json();
	Socket = new WebSocket(Pages.find(Page=>Page.type==='page').webSocketDebuggerUrl);
	await new Promise((Resolve,Reject)=>{ Socket.onopen = Resolve; Socket.onerror = Reject; });
	Socket.onmessage = Event =>
	{
		const Data = JSON.parse(Event.data);
		if(Data.id)
		{
			const Pair = Pending.get(Data.id);
			if(Pair) { Pending.delete(Data.id); Data.error?Pair.reject(Error(JSON.stringify(Data.error))):Pair.resolve(Data.result); }
		}
		else if(Data.method === 'Network.requestWillBeSent') { Report.requests.push({url:Data.params.request.url,method:Data.params.request.method,type:Data.params.type}); }
		else if(Data.method === 'Runtime.exceptionThrown') { Report.browserErrors.push(Data.params.exceptionDetails.exception?.description ?? Data.params.exceptionDetails.text); }
		else if(Data.method === 'Fetch.requestPaused')
		{
			const Allowed = Data.params.request.url.startsWith(Origin+'/') || Data.params.request.url.startsWith('data:');
			void call(Allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:Data.params.requestId,...(Allowed?{}:{errorReason:'BlockedByClient'})}).catch(ErrorValue=>Report.browserErrors.push(String(ErrorValue)));
		}
	};
	await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
	await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
	await call('Page.navigate',{url:Origin+'/'}); await ready();
	Report.browserVersion = await call('Browser.getVersion');
	for(const Theme of ['theme-dark','theme-light'])
	{
		for(const Mobile of [false,true])
		{
			for(const Width of [320,420,820])
			{
				const Name = `${Width}-${Theme}-${Mobile?'mobile':'desktop'}`, Surface = {name:Name,width:Width,theme:Theme,mobileEmulated:Mobile,checks:[]};
				if(Focus && Focus !== Name) { continue; }
				Report.surfaces.push(Surface);
				try
				{
					await emulate(Width,Mobile);
					const Position = await evaluate('start_interactive_case('+JSON.stringify({Width,Theme,Mobile})+')');
					// The public app stylesheet lazily requests its code font when raw fallback code first appears.
					// Resolve that fixture asset before measuring any user interaction, including failed font loads.
					await evaluate('document.fonts.load(\'14px "Source Code Pro"\').catch(()=>[]).then(()=>document.fonts.ready).then(()=>true)');
					await new Promise(Resolve=>setTimeout(Resolve,60)); const NetworkStart = Report.requests.length;
					await drag(Position,Mobile);
					const Result = await evaluate('exercise_interactive_case()');
					writeFileSync(join(Directory,'reading-'+Name+'.md'),Result.exportedMarkdown ?? '');
					await evaluate('interactive_screenshot_position(false)'); await screenshot('interactive-plot-'+Name,Width);
					if(Width===320) { await evaluate('interactive_screenshot_position(true)'); await screenshot('interactive-symbols-'+Name,Width); }
					await evaluate('exercise_explanation_actions()');
					if(Width===320) { await screenshot('explanation-actions-'+Name,Width); }
					await evaluate('exercise_structure_components()');
					if(Width===320) { await screenshot('structure-components-'+Name,Width); }
					if(Width===320) { await evaluate('InteractiveCase.Root.querySelector(".codex-walkthrough").scrollIntoView({block:"start"});true'); await screenshot('walkthrough-'+Name,Width); }
					await evaluate('exercise_interactive_fallbacks()');
					Surface.checks = await evaluate('InteractiveCase.Checks'); Surface.storage = await evaluate('Object.fromEntries(Object.keys(localStorage).filter(K=>K.startsWith("codex-sidebar-interactive:v1:"+encodeURIComponent(InteractiveCase.OriginalScope))).map(K=>[K,localStorage.getItem(K)]))');
					Surface.networkRequestsDuringInteraction = Report.requests.slice(NetworkStart);
					Surface.checks.push({name:'cdp-no-network-during-interaction',passed:!Surface.networkRequestsDuringInteraction.length});
				}
				catch(ErrorValue)
				{
					Surface.error = String(ErrorValue.stack ?? ErrorValue); Surface.checks = await evaluate('window.InteractiveCase?.Checks ?? []').catch(()=>Surface.checks);
					await screenshot('failure-'+Name,Width).catch(()=>{});
				}
				console.log(JSON.stringify({surface:Name,passed:Surface.checks.filter(Check=>Check.passed).length,failed:Surface.checks.filter(Check=>!Check.passed).map(Check=>Check.name),error:Surface.error}));
			}
		}
	}
	Report.preReloadFixtureEvidence = await evaluate('({requests:InteractiveEvidence.requests,errors:InteractiveEvidence.errors,markdownRenders:InteractiveEvidence.renders.length,notices:InteractiveEvidence.notices,registered:InteractiveEvidence.registered,disposed:InteractiveEvidence.disposed})');
	// A page reload recreates the JS heap while retaining the browser's real origin-local storage.
	await emulate(320,true);
	await evaluate('start_interactive_case('+JSON.stringify({Width:320,Theme:'theme-dark',Mobile:true,Scope:'interactive-page-reload'})+')');
	const Expected = await evaluate('prepare_interactive_reload()');
	await call('Page.reload',{ignoreCache:true}); await ready();
	await evaluate('start_interactive_case('+JSON.stringify({Width:320,Theme:'theme-dark',Mobile:true,Scope:Expected.scope})+')');
	const Reload = await evaluate('verify_interactive_reload('+JSON.stringify(Expected)+')'); Report.reload = Reload;
	await evaluate('interactive_screenshot_position(false)'); await screenshot('interactive-reloaded-320-theme-dark-mobile',320);
	Report.fixtureEvidence = await evaluate('({requests:InteractiveEvidence.requests,errors:InteractiveEvidence.errors,markdownRenders:InteractiveEvidence.renders.length,notices:InteractiveEvidence.notices,registered:InteractiveEvidence.registered,disposed:InteractiveEvidence.disposed})');
	await evaluate('close_interactive_case()');
	Report.sourceTimesAfter = source_times();
	Report.sourceChangedDuringRun = SourcePaths.filter(Path=>Report.sourceTimes[Path] !== Report.sourceTimesAfter[Path]);
	for(const Surface of Report.surfaces)
	{
		if(Surface.error) { Report.failures.push({surface:Surface.name,error:Surface.error}); }
		for(const Check of Surface.checks.filter(Check=>!Check.passed)) { Report.failures.push({surface:Surface.name,...Check}); }
	}
	for(const Check of Reload.checks.filter(Check=>!Check.passed)) { Report.failures.push({surface:'page-reload',...Check}); }
	if(Report.sourceChangedDuringRun.length) { Report.failures.push({name:'source-changed-during-run',paths:Report.sourceChangedDuringRun}); }
	if(Report.browserErrors.length || Report.fixtureEvidence.errors.length || Report.preReloadFixtureEvidence.errors.length) { Report.failures.push({name:'browser-errors',errors:[...Report.browserErrors,...Report.fixtureEvidence.errors,...Report.preReloadFixtureEvidence.errors]}); }
}
catch(ErrorValue) { Report.failures.push({name:'harness-error',error:String(ErrorValue.stack ?? ErrorValue)}); }
finally
{
	Report.finishedAt = new Date().toISOString(); Report.focus = Focus ?? null; Report.passed = Report.failures.length === 0 && Report.surfaces.length === (Focus ? 1 : 12) && !!Report.reload;
	writeFileSync(join(Directory,'report.json'),JSON.stringify(Report,null,2));
	Socket?.close(); Child?.kill(); if(Server) { Server.closeAllConnections(); await new Promise(Resolve=>Server.close(Resolve)); }
	for(const Pair of Pending.values()) { Pair.reject(Error('Browser fixture closed')); } Pending.clear();
	console.log(JSON.stringify({passed:Report.passed,directory:Directory,report:join(Directory,'report.json'),surfaces:Report.surfaces.length,failures:Report.failures,screenshots:Report.screenshots},null,2));
	if(!Report.passed) { process.exitCode = 1; }
}
