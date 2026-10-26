import { test } from "node:test";
import { answer_quote } from "../src/quote";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto, randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { jpeg_info } from "../src/pdf/types";
import { version_of } from "../src/edit/document";
import { IDBFactory } from "fake-indexeddb";
import { open_edit_store } from "../src/edit/database";
import { session_stamp } from "../src/sessions";

test("message tombstones survive stale snapshots, late stream frames and restart without deleting the same ID in another branch", async () =>
{
	const F = await mobile_fixture(bootstrap_http()), P = F.Instance; P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	let SessionId = "";
	try
	{
		await P.ensure_connection(); SessionId = P.Session.Id; P.Session.ThreadId = "original-deleted-thread";
		const Source = { Id: "kept-question", Role: "user", Text: "original question", Prompt: "original $x$", TurnId: "original-deleted-turn" }, Reply = { Id: "deleted-answer", Role: "assistant", Text: "old proof", TurnId: "original-deleted-turn" };
		P.Session.Messages.push(Source, Reply); P.State.Sessions.push({ Id: "independent-branch", Title: "branch", ParentId: SessionId, ThreadId: null, Messages: [structuredClone(Reply)] });
		const Stale = structuredClone(P.State); P.State.DeletedMessages = [{ SessionId, MessageId: Reply.Id }]; P.merge_restored(Stale);
		assert.deepEqual([...P.Session.Messages.map((M: any) => M.Id)], [Source.Id]);
		P.handle_message({ method: "item/agentMessage/delta", params: { threadId: "original-deleted-thread", itemId: Reply.Id, turnId: Source.TurnId, delta: "late" } });
		P.handle_message({ method: "bridge/message-updated", params: { threadId: "original-deleted-thread", sessionId: SessionId, message: { ...Reply, Text: "late full proof", SyncVersion: { Origin: "scope", Revision: 9, Digest: "late" } } } });
		assert.equal(P.Session.Messages.some((M: any) => M.Id === Reply.Id), false); assert.equal(P.State.Sessions.find((S: any) => S.Id === "independent-branch").Messages[0].Text, "old proof");
		await P.persist(false);
	}
	finally { P.onunload(); }
	const R = await mobile_fixture(bootstrap_http(), { Files: F.Files, Local: F.Local });
	try { assert.equal(R.Instance.State.Sessions.find((S: any) => S.Id === SessionId).Messages.some((M: any) => M.Id === "deleted-answer"), false); assert.equal(R.Instance.State.Sessions.find((S: any) => S.Id === "independent-branch").Messages.length, 1); }
	finally { R.Instance.onunload(); }
});
import { RemoteBridge, token_hash } from "../src/bridge";
import { content_digest } from "../src/sync/types";

const Databases = new WeakMap<Map<string, string>, IDBFactory>();

async function wait_for_edit(Instance: any): Promise<void>
{
	for(let Index = 0; Index < 400 && !Instance.Edits.Store.Data.Writes.length; Index++) { await new Promise(Resolve => setTimeout(Resolve, 5)); }
}

async function mobile_fixture(Http?: (Params: any) => Promise<any>, Saved?: { Files?: Map<string, string>; Local?: Map<string, string> })
{
	const Required: string[] = []; const Files = Saved?.Files ?? new Map<string, string>(); const Local = Saved?.Local ?? new Map<string, string>();
	if(!Databases.has(Local)) { Databases.set(Local, new IDBFactory()); }
	const WorkspaceEvents = new Map<string, ((...Args: any[]) => void)[]>(), Views = new Map<string, (Leaf: any) => any>();
	const Tabs: any[] = [], Settings: any[] = [], Notices: string[] = [];
	class Component { constructor(..._Args: any[]) { } }
	class Setting
	{
		Name = ""; Desc = ""; Controls: any[] = [];
		constructor(_Root: any) { Settings.push(this); }
		setName(Value: string) { this.Name = Value; return this; }
		setDesc(Value: string) { this.Desc = Value; return this; }
		control(Type: string, Build: (Value: any) => void)
		{
			const Value: any = { Type, inputEl: { style: {}, setAttribute() {}, addClass() {} }, Options: {}, setValue(Value: unknown) { this.Value = Value; return this; }, setDisabled(Value: boolean) { this.Disabled = Value; return this; }, setPlaceholder() { return this; }, setButtonText(Text: string) { this.Text = Text; return this; }, setCta() { return this; }, addOption(Key: string, Label: string) { this.Options[Key] = Label; return this; }, onChange(Handler: any) { this.Change = Handler; return this; }, onClick(Handler: any) { this.Click = Handler; return this; } };
			this.Controls.push(Value); Build(Value); return this;
		}
		addToggle(Build: (Value: any) => void) { return this.control("toggle", Build); }
		addDropdown(Build: (Value: any) => void) { return this.control("dropdown", Build); }
		addText(Build: (Value: any) => void) { return this.control("text", Build); }
		addTextArea(Build: (Value: any) => void) { return this.control("textarea", Build); }
		addButton(Build: (Value: any) => void) { return this.control("button", Build); }
	}
	class SettingTab extends Component { containerEl = { empty: () => { Settings.length = 0; }, createEl: () => ({}) }; }
	class Notice { constructor(Text: string) { Notices.push(Text); } }
	class Plugin
	{
		manifest = { id: "codex-sidebar", dir: ".obsidian/plugins/codex-sidebar" };
		app = {
			vault: {
				on: () => {},
				getName: () => "test", adapter: {
					exists: async (Path: string) => Files.has(Path), read: async (Path: string) => Files.get(Path), write: async (Path: string, Text: string) =>
					{
						Files.set(Path, Text);
					}
				}
			},
			workspace: {
				activeLeaf: null as any,
				on: (Name: string, Handler: (...Args: any[]) => void) => { WorkspaceEvents.set(Name, [...WorkspaceEvents.get(Name) ?? [], Handler]); },
				onLayoutReady: () =>
				{
				}, getLeavesOfType: () => [], getActiveFile: () => null
			}
		};
		addStatusBarItem()
		{
			return {
				setText()
				{
				}
			};
		}
		registerEditorExtension()
		{
		} registerView(Name: string, Factory: (Leaf: any) => any)
		{
			Views.set(Name, Factory);
		} addCommand()
		{
		} addSettingTab(Tab: any)
		{
			Tabs.push(Tab);
		} registerMarkdownPostProcessor()
		{
		} registerEvent()
		{
		}
		registerDomEvent()
		{
		}
		addRibbonIcon()
		{
			return {
				addClass()
				{
				}, toggleClass()
				{
				}
			};
		}
		loadData()
		{
			throw new Error("desktop data must stay isolated");
		}
	}
	const Export = { exports: {} as any };
	const Define = () => ({});
	let BrowserRequests = 0;
	runInNewContext(readFileSync(process.env.CODEX_SIDEBAR_TEST_BUNDLE ?? "main.js", "utf8"), {
		module: Export, exports: Export.exports, crypto: { subtle: webcrypto.subtle, randomUUID }, indexedDB: Databases.get(Local), DOMException, structuredClone, URL, Error, AbortController, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
		fetch: async (Url: string, Params: any) =>
		{
			BrowserRequests++;
			const Response = await Http?.({ ...Params, url: Url });
			return { status: Response.status, json: async () => Response.json };
		},
		localStorage: { getItem: (Key: string) => Local.get(Key), setItem: (Key: string, Value: string) => Local.set(Key, Value) },
		require(Name: string)
		{
			Required.push(Name);
			if(Name === "obsidian")
			{
				return { Plugin, ItemView: Component, PluginSettingTab: SettingTab, Setting, Modal: Component, MarkdownView: Component, Notice, Platform: { isMobileApp: true }, requestUrl: Http };
			}
			if(Name === "@codemirror/state")
			{
				return { StateEffect: { define: Define }, StateField: { define: Define }, Prec: { highest: Define } };
			}
			if(Name === "@codemirror/view")
			{
				return { WidgetType: Component, keymap: { of: Define }, ViewPlugin: { fromClass: Define } };
			}
			throw new Error("mobile loaded forbidden module: " + Name);
		}
	});
	const Instance = new Export.exports.default(); await Instance.onload();
	return { Instance, Files, Required, Local, Tabs, Settings, Notices, MarkdownView: Component, Views, emit: (Name: string, ...Args: any[]) => WorkspaceEvents.get(Name)?.forEach(Handler => Handler(...Args)), browser_requests: () => BrowserRequests };
}

function bootstrap_http(Before?: (Params: any) => Promise<void>)
{
	let Threads = 0, Turns = 0;
	return async (Params: any) =>
	{
		await Before?.(Params);
		const Path = new URL(Params.url).pathname;
		const Body = Params.body ? JSON.parse(Params.body) : null;
		let Value: any = {};
		if(Path === "/info")
		{
			Value = { server: "test", vault: "test", cwd: "/vault", cli: "mock", pdfPageImages: 1 };
		}
		else if(Path === "/state")
		{
			Value = { state: null, cursor: 0 };
		}
		else if(Path === "/events")
		{
			Value = { events: [], cursor: 0 };
		}
		else if(Body?.method === "account/read")
		{
			Value = { account: { type: "chatgpt" } };
		}
		else if(Body?.method === "model/list")
		{
			Value = { data: [{ model: "test-model", displayName: "Test", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: null };
		}
		else if(Body?.method === "skills/list")
		{
			Value = { data: [{ cwd: "/vault", skills: [{ name: "math-writing", path: "/skills/SKILL.md", enabled: true }] }] };
		}
		else if(Body?.method === "thread/start")
		{
			Threads++; Value = { model: "test-model", reasoningEffort: "low", thread: { id: "fixture-thread" + (Threads > 1 ? "-" + Threads : ""), ephemeral: true, path: null, turns: [] } };
		}
		else if(Body?.method === "turn/start")
		{
			Turns++; Value = { turn: { id: "fixture-turn" + (Turns > 1 ? "-" + Turns : "") } };
		}
		return { status: 200, json: Value };
	};
}

function deferred<T = void>()
{
	let Resolve!: (Value: T | PromiseLike<T>) => void;
	const PromiseValue = new Promise<T>(R => { Resolve = R; }); return { Promise: PromiseValue, resolve: Resolve };
}
async function wait_until(Check: () => boolean, Description: string): Promise<void>
{
	for(let I = 0; I < 300 && !Check(); I++) { await new Promise(R => setTimeout(R, 5)); }
	assert.ok(Check(), Description);
}

function source_view(Fixture: Awaited<ReturnType<typeof mobile_fixture>>, Path: string, Text: string)
{
	const View = new Fixture.MarkdownView() as any;
	Object.assign(View, { file: { path: Path }, containerEl: { isConnected: true }, getViewType: () => "markdown", getMode: () => "source", getViewData: () => Text, editor: { getSelection: () => "", getCursor: () => ({ line: 0, ch: 0 }), posToOffset: (Pos: { line: number; ch: number }) => Text.split("\n").slice(0, Pos.line).reduce((N, L) => N + L.length + 1, 0) + Pos.ch, lineCount: () => Text.split("\n").length } });
	const Workspace = Fixture.Instance.app.workspace;
	Workspace.activeLeaf = { view: View }; Workspace.getActiveViewOfType = () => Workspace.activeLeaf?.view.getViewType() === "markdown" ? Workspace.activeLeaf.view : null;
	Workspace.getActiveFile = () => Workspace.activeLeaf?.view.file ?? null;
	Fixture.Instance.app.vault.getFileByPath = (Value: string) => ({ path: Value }); Fixture.Instance.app.metadataCache = { getFileCache: () => ({ headings: [] }) };
	return View;
}

test("native note event handlers in the mobile-safe bundle switch locally without RPC, keep source/history/settings, and defer drafts and turns", async () =>
{
	const F = await mobile_fixture(), P = F.Instance;
	try
	{
		const Old = P.State.ActiveId; source_view(F, "A.md", "# A\n\n$x=1$."); F.emit("file-open");
		assert.equal(P.NoteSessions.Data.Enabled, true); assert.equal(P.NoteSessions.Path, "A.md");
		Object.assign(P.State.Settings, { Model: "saved-model", Effort: "xhigh", Fast: true }); const Settings = JSON.stringify(P.State.Settings);
		await P.NoteSessions.flush(); const A = P.State.ActiveId; assert.notEqual(A, Old); assert.ok(P.State.Sessions.some((Value: any) => Value.Id === Old)); assert.equal(P.Capture.Snapshot.Path, "A.md");
		P.Session.Messages.push({ Id: "original", Role: "user", Text: "original question", Context: structuredClone(P.Capture.Snapshot) });
		P.Busy = true; source_view(F, "B.md", "# B\n\n$x=2$."); F.emit("active-leaf-change"); F.emit("file-open"); await P.NoteSessions.flush();
		assert.equal(P.State.ActiveId, A); assert.equal(P.Capture.Snapshot.Path, "A.md");
		P.Busy = false; await P.NoteSessions.flush(); const B = P.State.ActiveId; assert.notEqual(A, B); assert.equal(P.Capture.Snapshot.Path, "B.md");
		assert.equal(P.State.Sessions.find((Value: any) => Value.Id === A).Messages[0].Context.Path, "A.md");
		const Sidebar = F.Views.get("codex-sidebar-view")!({}); Sidebar.Input = { value: "中文草稿" };
		P.app.workspace.getLeavesOfType = (Type: string) => Type === "codex-sidebar-view" ? [{ view: Sidebar }] : [];
		source_view(F, "A.md", "# A\n\n$x=1$."); F.emit("file-open"); await P.NoteSessions.flush(); assert.equal(P.State.ActiveId, B);
		Sidebar.Input.value = ""; await P.NoteSessions.flush(); assert.equal(P.State.ActiveId, A);
		P.app.workspace.activeLeaf = { view: { getViewType: () => "codex-sidebar-view" } }; F.emit("active-leaf-change"); assert.equal(P.State.ActiveId, A);
		assert.equal(JSON.stringify(P.State.Settings), Settings); assert.equal(P.State.Sessions.length, 3); assert.equal(F.browser_requests(), 0); assert.equal(P.NoteSessions.Error, "");
		assert.equal(JSON.stringify(P.State).includes("codex-sidebar-note-sessions"), false);
		P.State.Settings.AutoCapture = false; source_view(F, "C.md", "# Private capture opt-out"); F.emit("file-open"); await P.NoteSessions.flush(); assert.equal(P.Capture.Snapshot, null);
	}
	finally { P.onunload(); }
});

test("bridge restore retains locally linked note sessions and the intended active conversation and client edit scope without mixing local mappings into remote state", async () =>
{
	for(const ServerScope of [undefined, "ai"])
	{
	const Ordinary = bootstrap_http(), F = await mobile_fixture(async Params =>
	{
		if(new URL(Params.url).pathname === "/state" && Params.method === "GET") { return { status: 200, json: { state: { Settings: { Model: "test-model", Effort: "low", EditScope: ServerScope }, Sessions: [{ Id: "server-existing", Title: "Server", ThreadId: null, Messages: [] }], ActiveId: "server-existing" }, cursor: 0 } }; }
		return Ordinary(Params);
	});
	const P = F.Instance;
	try
	{
		source_view(F, "A.md", "# A"); F.emit("file-open"); await P.NoteSessions.flush(); const A = P.State.ActiveId;
		P.Session.Messages.push({ Id: "local-only", Role: "user", Text: "unsynced note history" });
		P.State.Settings.EditScope = "captured";
		P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture"; P.Remote.Transport = "native";
		await P.ensure_connection(); assert.equal(P.State.ActiveId, A); assert.equal(P.Session.Messages[0].Id, "local-only");
		assert.ok(P.State.Sessions.some((Value: any) => Value.Id === "server-existing")); assert.equal(P.NoteSessions.Data.Links[0].SessionId, A);
		assert.equal(JSON.stringify(P.State).includes('"Links"'), false);
		assert.equal(P.State.Settings.EditScope, "captured");
	}
	finally { P.onunload(); }
	}
});

test("question actions never infer a preview from request text, including the former write-intent trigger", async () =>
{
	for(const Text of ["写一个简短的17题证明上去, 只需包含思路", "请修正这段证明", "解答"])
	for(const Mode of [undefined, "question"])
	{
		const { Instance } = await mobile_fixture(bootstrap_http());
		Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
		try
		{
			assert.equal(await Instance.send_chat(Text, null, null, Mode ? { Mode } : {}), true);
			assert.equal(Instance.Session.Messages.find((Value: any) => Value.Role === "user").Task, undefined);
			assert.equal(Instance.Edits.Store.Data.Records.length, 0);
		}
		finally { Instance.onunload(); }
	}
});

test("the actual composer handler preserves drafts and quotes on rejected or superseded submissions", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, View = F.Views.get("codex-sidebar-view")!({});
	const Calls: any[] = [], Quote = { SessionId: P.Session.Id, MessageId: "answer", SelectedText: "片段", SourceText: "$x=1$", SelectedTruncated: false, SourceTruncated: false };
	View.Input = { value: "写入笔记" }; P.State.Settings.EditScope = "captured"; View.refresh_quote = () => {};
	P.AnswerQuote = Quote;
	P.send_chat = async (...Args: any[]) => { Calls.push(Args); return false; };
	try
	{
		await View.send_input("question"); assert.equal(View.Input.value, "写入笔记"); assert.equal(P.AnswerQuote, Quote);
		assert.equal(Calls[0][3].Mode, "question"); assert.equal(Calls[0][2], Quote);
		P.AnswerQuote = null; let Release!: (Value: boolean) => void;
		P.send_chat = async (...Args: any[]) => { Calls.push(Args); return new Promise<boolean>(Resolve => Release = Resolve); };
		const Pending = View.send_input("edit"); View.Input.value = "新的草稿"; Release(true); await Pending;
		assert.equal(View.Input.value, "新的草稿"); assert.deepEqual(JSON.parse(JSON.stringify(Calls[1][3])), { Mode: "edit", Scope: "captured", Role: "auto" });
		P.send_chat = async () => true; await View.send_input("question"); assert.equal(View.Input.value, "");
	}
	finally { P.onunload(); }
});

test("accepting and cancelling an answer quote immediately refreshes the explicit preview action", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, View = F.Views.get("codex-sidebar-view")!({});
	const States: boolean[] = []; let Cancel!: () => void;
	View.Input = { value: "" }; View.ComposePanel = { Summary: { setText: () => {} } };
	View.ComposeActions = { refresh: (_: boolean, __: boolean, Quoted: boolean) => States.push(Quoted) };
	View.QuoteElement = { empty: () => {}, createDiv: () => {}, createEl: () => {} };
	View.button = (_: any, Text: string, Callback: () => void) => { if(Text === "取消引用") { Cancel = Callback; } };
	try
	{
		View.refresh_quote(); assert.equal(States.at(-1), false);
		P.AnswerQuote = { SessionId: P.Session.Id, MessageId: "answer", SelectedText: "片段", SourceText: "$x$", SelectedTruncated: false, SourceTruncated: false };
		View.refresh_quote(); assert.equal(States.at(-1), true); assert.match(View.Input.placeholder, /Enter 提问/);
		Cancel(); assert.equal(P.AnswerQuote, null); assert.equal(States.at(-1), false);
	}
	finally { P.onunload(); }
});

test("ordinary mobile chat edits use the two-input skilled turn and the local confirmation writer; replay never changes to current focus", async () =>
{
	const Requests: any[] = [];
	const { Instance, Local, Required } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture"; Instance.Remote.Transport = "native";
	const Old = "证明: $1+1=3$.", New = "证明: $1+1=2$.", Before = "private-outside-snapshot\n\n" + Old + "\n\nkeep-tail";
	let Current = Before, Writes = 0;
	Instance.Edits.Host.read_current = async () => Current;
	Instance.Edits.Host.compare_write = async (_: string, Expected: string, Next: string) => { assert.equal(Current, Expected); Current = Next; Writes++; };
	const From = Before.indexOf(Old);
	const Source: any = { Path: "scratch.md", Mode: "编辑", Kind: "选区", Text: Old, SelectedText: Old, Selection: { From, To: From + Old.length }, Mapping: "源文本", Heading: "证明", LineStart: 2, LineEnd: 2, Truncated: false, CapturedAt: "original-time", Version: await version_of(Before) };
	try
	{
		assert.equal(await Instance.send_chat("请修正这段证明", Source, null, { Mode: "edit", Scope: "captured" }), true);
		const Turn = Requests.find(Value => Value.method === "turn/start");
		assert.equal(Turn.params.input.length, 2); assert.equal(Turn.params.input[1].name, "math-writing");
		const Task = JSON.parse(Turn.params.input[0].text.split("任务:\n")[1]);
		assert.equal(Task.Action, "edit"); assert.equal(Task.Target.Before, null); assert.equal(Task.WriteUnit.Text, Old);
		assert.ok(!JSON.stringify(Requests).includes("private-outside-snapshot"));
		assert.equal(Writes, 0);
		const Out = JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: New, rationale: "仅纠正加法结果." });
		Instance.handle_message({ method: "item/completed", params: { threadId: "fixture-thread", turnId: "fixture-turn", item: { id: "edit-final", type: "agentMessage", phase: "final_answer", text: Out } } });
		Instance.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		await wait_for_edit(Instance);
		assert.equal(Instance.Edits.Store.Data.Writes.length, 1); assert.equal(Writes, 0);
		const Plan = Instance.Edits.Store.Data.Writes[0];
		await Promise.all([Instance.Edits.confirm(Plan.Id), Instance.Edits.confirm(Plan.Id)]);
		assert.equal(Writes, 1); assert.equal(Current, Before.replace(Old, New));
		await Instance.Edits.undo(Plan.Id); assert.equal(Current, Before);
		const User = Instance.Session.Messages.find((Value: any) => Value.Role === "user");
		Instance.Capture.Snapshot = { ...Source, Path: "unrelated.md", Text: "new-focus" };
		assert.equal(await Instance.resend_message(User.Id), true);
		const Replay = Instance.Session.Messages.findLast((Value: any) => Value.Role === "user");
		assert.equal(Replay.Task.Source.Path, "scratch.md"); assert.equal(Replay.Task.Source.CapturedAt, "original-time"); assert.notEqual(Replay.Task.Id, User.Task.Id);
		const Persisted = await open_edit_store({ getItem: Key => Local.get(Key) ?? null, setItem: () => {} }, "test", Databases.get(Local));
		assert.equal(Persisted.Data.Records.length, Instance.Edits.Store.Data.Records.length); await Persisted.close();
		assert.ok(!Local.has("codex-sidebar-edits:v2:test")); assert.ok(!JSON.stringify(Instance.State).includes("private-outside-snapshot"));
		assert.ok(Required.every(Name => ["obsidian", "@codemirror/state", "@codemirror/view"].includes(Name)));
	}
	finally { Instance.onunload(); }
});

test("integrated follow-ups use saved math snapshots on mobile send and resend without editing notes or original answers", async () =>
{
	const Requests: any[] = [];
	const { Instance: P } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture"; P.Remote.Transport = "native";
	const Source = "起点: $x^2$.\n\n$$\\int_0^1 x^2\\,dx=\\frac13$$\n\n结论: 积分为正.";
	const Original = { Id: "answer", Role: "assistant", Text: Source, CompletionStatus: "completed" };
	P.Session.Messages.push(Original);
	const OriginalSession = P.Session;
	const Quote = answer_quote(P.Session.Id, "answer", "∫₀¹ x² dx", Source, "completed");
	try
	{
		assert.equal(await P.send_chat("为什么这里除以3?", null, Quote), true);
		const Sent = P.Session.Messages.findLast((Value: any) => Value.Role === "user");
		const Turn = Requests.find(Value => Value.method === "turn/start");
		assert.equal(Turn.params.input.length, 2); assert.equal(Turn.params.input[1].name, "math-writing");
		assert.equal(Turn.params.input[0].text, Sent.Prompt); assert.match(Sent.Prompt, /整合后的完整说明/);
		assert.equal(Sent.Quote.SourceText, Source); assert.equal(Sent.Task, undefined); assert.equal(Sent.Context, null);
		Quote.SourceText = "later mutation";
		P.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		P.Capture.Snapshot = { Path: "other-note.md", Text: "unrelated-new-focus" };
		assert.equal(await P.resend_message(Sent.Id, "这一步如何连接结论?"), true);
		const Replay = P.Session.Messages.findLast((Value: any) => Value.Role === "user");
		assert.equal(Replay.Quote.SourceText, Source); assert.equal(Replay.Quote.FollowupMode, "integrated-v1");
		assert.equal(Replay.Context, null); assert.match(Replay.Prompt, /^这一步如何连接结论\?/);
		assert.match(Replay.Prompt, /整合后的完整说明/); assert.ok(!Replay.Prompt.includes("unrelated-new-focus"));
		assert.equal(OriginalSession.Messages.find((Value: any) => Value.Id === "answer").Text, Source);
		assert.equal(OriginalSession.Messages.find((Value: any) => Value.Id === Sent.Id).Text, "为什么这里除以3?");
		assert.equal(P.Edits.Store.Data.Records.length, 0); assert.equal(P.Edits.Store.Data.Writes.length, 0);
	}
	finally { P.onunload(); }
});

test("question-only chat and answer quotes do not acquire edit tasks; missing skills prevent submission", async () =>
{
	const Requests: any[] = [];
	const { Instance } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	try
	{
		assert.equal(await Instance.send_chat("修改建议是什么", null, null, { Mode: "question" }), true);
		assert.equal(Instance.Session.Messages.find((Value: any) => Value.Role === "user").Task, undefined);
		assert.equal(Instance.Edits.Store.Data.Records.length, 0);
		Instance.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		const Quote = { SessionId: "old", MessageId: "old-answer", SelectedText: "回答片段", SourceText: "回答片段", SelectedTruncated: false, SourceTruncated: false };
		assert.equal(await Instance.send_chat("请修改这段回答的说法", null, Quote), true);
		assert.equal(Instance.Session.Messages.findLast((Value: any) => Value.Role === "user").Task, undefined);
		assert.equal(Instance.Edits.Store.Data.Records.length, 0);
	}
	finally { Instance.onunload(); }
	const Ordinary = bootstrap_http();
	const F = await mobile_fixture(async Params => JSON.parse(Params.body ?? "null")?.method === "skills/list" ? { status: 200, json: { data: [] } } : Ordinary(Params));
	F.Instance.Remote.Url = "https://example.test"; F.Instance.Remote.Token = "fixture";
	F.Instance.Edits.Host.read_current = async () => "原文";
	const Source: any = { Path: "scratch.md", Mode: "阅读", Kind: "当前位置", Text: "原文", SelectedText: "", Mapping: "源块", Heading: "", LineStart: 0, LineEnd: 0, Truncated: false, CapturedAt: "t", Version: await version_of("原文") };
	try
	{
		assert.equal(await F.Instance.send_chat("修改这里", Source, null, { Mode: "edit" }), false);
		assert.equal(F.Instance.Edits.Store.Data.Writes.length, 0);
		assert.match(F.Instance.Status, /math-writing|技能/);
	}
	finally { F.Instance.onunload(); }
});

test("ordinary edits respect host read-only metadata before model submission", async () =>
{
	const Requests: any[] = [];
	const { Instance } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	Instance.Edits.Host.read_current = async () => "教师原题";
	Instance.app.vault.getFileByPath = () => ({ path: "scratch.md" });
	Instance.app.metadataCache = { getFileCache: () => ({ frontmatter: { "codex-readonly": true } }) };
	const Source: any = { Path: "scratch.md", Mode: "阅读", Kind: "当前位置", Text: "教师原题", SelectedText: "", Mapping: "源块", Heading: "", LineStart: 0, LineEnd: 0, Truncated: false, CapturedAt: "t", Version: await version_of("教师原题") };
	try
	{
		assert.equal(await Instance.send_chat("帮我改一下", Source, null, { Mode: "edit" }), false);
		assert.equal(Requests.filter(Value => Value.method === "turn/start").length, 0);
		assert.equal(Instance.Edits.Store.Data.Records.length, 0);
		assert.match(Instance.Status, /只读/);
	}
	finally { Instance.onunload(); }
});

test("explicitly requesting a short proof preview produces a real preview before any client write", async () =>
{
	const Requests: any[] = [], Before = "# 原创微型第17题\n\n验证 $1+1=2$.\n\n#### 答案\n\n", Original = "#### 答案\n\n";
	const { Instance } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	let Current = Before, Writes = 0;
	Instance.Edits.Host.read_current = async () => Current;
	Instance.Edits.Host.compare_write = async (_: string, Expected: string, Next: string) => { assert.equal(Current, Expected); Current = Next; Writes++; };
	const Source: any = { Path: "scratch.md", Mode: "编辑", Kind: "选区", Text: "验证 $1+1=2$.", SelectedText: "验证 $1+1=2$.", Selection: { From: Before.indexOf("验证"), To: Before.indexOf("验证") + "验证 $1+1=2$.".length }, Mapping: "源文本", Heading: "第17题", LineStart: 2, LineEnd: 2, Truncated: false, CapturedAt: "original-time", Version: await version_of(Before) };
	try
	{
		assert.equal(await Instance.send_chat("写一个简短的17题证明上去, 只需包含思路", Source, null, { Mode: "edit", Scope: "ai", Role: "auto" }), true);
		const User = Instance.Session.Messages.find((Value: any) => Value.Role === "user");
		assert.equal(User.Task?.Action, "edit", "the writing request must enter the existing edit controller instead of plain chat");
		const Turn = Requests.find(Value => Value.method === "turn/start");
		assert.equal(Turn.params.input.length, 2); assert.equal(Turn.params.input[1].name, "math-writing");
		assert.equal(User.Task.EditMode, "ai"); assert.equal(User.Task.Source.CapturedAt, "original-time");
		const Markdown = "#### 答案\n\n思路: 将两个单位相加, 得 $1+1=2$.\n\n";
		const Output = { schemaVersion: 1, kind: "note-edit", status: "proposal", original: Original, markdown: Markdown, rationale: "只填充第17题答案留白, 保留题面和相邻内容" };
		Instance.handle_message({ method: "item/completed", params: { threadId: "fixture-thread", turnId: "fixture-turn", item: { id: "proof-final", type: "agentMessage", phase: "final_answer", text: JSON.stringify(Output) } } });
		Instance.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		await wait_for_edit(Instance);
		const Plan = Instance.Edits.Store.Data.Writes[0];
		assert.ok(Plan); assert.equal(Plan.State, "preview"); assert.equal(Writes, 0); assert.equal(Current, Before);
		await Promise.all([Instance.Edits.confirm(Plan.Id), Instance.Edits.confirm(Plan.Id)]);
		assert.equal(Writes, 1); assert.equal(Current, Before.replace(Original, Markdown));
		await Instance.Edits.undo(Plan.Id); assert.equal(Current, Before);
		Instance.Capture.Snapshot = { ...Source, Path: "unrelated.md", Text: "different focus" };
		assert.equal(await Instance.resend_message(User.Id), true);
		const Replay = Instance.Session.Messages.findLast((Value: any) => Value.Role === "user");
		assert.equal(Replay.Task.Action, "edit"); assert.notEqual(Replay.Task.Id, User.Task.Id);
		assert.equal(Replay.Task.Source.Path, "scratch.md"); assert.equal(Replay.Task.Source.CapturedAt, "original-time");
	}
	finally { Instance.onunload(); }
});

test("the preview action adopts a previous proposal through an AI edit task even after an old read-only answer, keeping the host window and transport", async () =>
{
	const Requests: any[] = [], Before = "介绍段落\n\n计算 $1+1=3$.\n\n保留后文", Original = "$1+1=3$";
	const { Instance } = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } }));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	let Current = Before, Writes = 0;
	Instance.Edits.Host.read_current = async () => Current;
	Instance.Edits.Host.compare_write = async (_: string, Expected: string, Next: string) => { assert.equal(Current, Expected); Current = Next; Writes++; };
	const Source: any = { Path: "scratch.md", Mode: "编辑", Kind: "选区", Text: "介绍段落", SelectedText: "介绍段落", Selection: { From: 0, To: 4 }, Mapping: "源文本", Heading: "", LineStart: 0, LineEnd: 0, Truncated: false, CapturedAt: "original-time", Version: await version_of(Before) };
	try
	{
		Instance.Session.Messages.push({ Id: "old-readonly-reply", Role: "assistant", Text: "当前工具只读, 可把错误改为 $1+1=2$. 尚未写入." });
		assert.equal(await Instance.send_chat("将你这个笔记改动方案落地", Source, null, { Mode: "edit", Scope: "ai" }), true);
		const Turn = Requests.find(Value => Value.method === "turn/start");
		assert.match(Turn.params.input[0].text, /任务:\n/, "adopting a proposal must submit a structured edit task instead of read-only chat");
		const Task = JSON.parse(Turn.params.input[0].text.split("任务:\n")[1]);
		assert.equal(Turn.params.input.length, 2); assert.equal(Turn.params.input[1].name, "math-writing"); assert.equal(Task.EditMode, "ai"); assert.equal(Task.Source.SelectedText, "介绍段落"); assert.equal(Task.Target.Before, null);
		const Output = { schemaVersion: 1, kind: "note-edit", status: "proposal", original: Original, markdown: "$1+1=2$", rationale: "只修正计算结果" };
		Instance.handle_message({ method: "item/completed", params: { threadId: "fixture-thread", turnId: "fixture-turn", item: { id: "ai-final", type: "agentMessage", phase: "final_answer", text: JSON.stringify(Output) } } });
		Instance.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		await wait_for_edit(Instance);
		const Plan = Instance.Edits.Store.Data.Writes[0]; assert.ok(Plan); assert.equal(Plan.Target.Range.From, Before.indexOf(Original)); assert.equal(Writes, 0);
		await Instance.Edits.confirm(Plan.Id); assert.equal(Writes, 1); assert.equal(Current, Before.replace(Original, "$1+1=2$"));
		assert.equal((Instance.State as any).Edits, undefined); assert.equal((Instance.State as any).Writes, undefined);
	}
	finally { Instance.onunload(); }
});

test("clearing note context refuses an already running source capture instead of reviving the preview", async () =>
{
	const F = await mobile_fixture(), View: any = new F.MarkdownView();
	F.Instance.app.vault.getFileByPath = () => null;
	Object.assign(View, { file: { path: "scratch.md" }, containerEl: { isConnected: true }, getViewType: () => "markdown", getMode: () => "source", getViewData: () => "abc", editor: { getSelection: () => "abc", getCursor: (Which: string) => ({ line: 0, ch: Which === "to" ? 3 : 0 }), posToOffset: (Pos: any) => Pos.ch, lineCount: () => 1 } });
	const Pending = F.Instance.Capture.capture("选区", View); F.Instance.clear_context();
	assert.equal(await Pending, null); assert.equal(F.Instance.Capture.Snapshot, null);
	const Fresh = await F.Instance.Capture.capture("选区", View); assert.equal(Fresh.SelectedText, "abc");
	F.Instance.onunload();
});

test("mobile native transport selection is device-local and reaches the same remote bootstrap without browser fetch", async () =>
{
	const Fixture = await mobile_fixture(bootstrap_http());
	const { Instance, Local, Required } = Fixture;
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture"; Instance.Remote.Transport = "native";
	Instance.save_remote_config();
	await Instance.ensure_connection();
	assert.equal(Instance.Models.length, 1);
	assert.equal(Fixture.browser_requests(), 0);
	assert.equal(JSON.parse(Local.get("codex-sidebar-remote:test")!).Transport, "native");
	assert.equal("Transport" in Instance.State.Settings, false);
	assert.ok(!Required.some(Value => Value.startsWith("node:") || Value === "electron"));
	Instance.onunload();
});

test("built mobile entry loads and initializes without Node, Electron or desktop adapter calls", async () =>
{
	const { Instance, Files, Required } = await mobile_fixture();
	assert.equal(Instance.Remote.Enabled, true);
	assert.equal(Instance.State.Sessions.length, 1);
	assert.ok(Required.every(Name => ["obsidian", "@codemirror/state", "@codemirror/view"].includes(Name)));
	await Instance.persist();
	const Canonical = Instance.RemoteStatePath;
	assert.deepEqual([...Files.keys()].sort(), [Canonical, Canonical + ".save.stage.json", Canonical + ".save.journal.json", Canonical + ".last-committed.json"].sort());
	const Data = JSON.parse(Files.get(Canonical)!); assert.equal(Data.SchemaVersion, 2); assert.equal(JSON.stringify(Data.Sessions), JSON.stringify(Instance.State.Sessions));
	assert.equal(JSON.parse(Files.get(Canonical + ".save.journal.json")!).Status, "committed");
	assert.equal(Files.get(Canonical), Files.get(Canonical + ".last-committed.json")); Instance.onunload();
});

test("removed workbench stays inactive while old local records and task snapshots survive restart", async () =>
{
	const Local = new Map([["codex-sidebar-study:v1:test", "original-private-study-records"]]);
	const F = await mobile_fixture(undefined, { Local });
	const P = F.Instance;
	const Source = { Path: "scratch.md", Mode: "阅读", Kind: "选区", Text: "$x$", SelectedText: "$x$", Mapping: "源块", Heading: "", LineStart: 0, LineEnd: 0, Truncated: false, CapturedAt: "original-time" };
	const Task = { SchemaVersion: 1, Id: "old-exercise", Action: "exercise", Role: "lecture", Scope: "nearby-exercise", HintLevel: "on-demand", Source, Prerequisites: [], CreatedAt: "original-time", Request: "给一题" };
	P.Session.Messages.push({ Id: "old-question", Role: "user", Text: "给一题", Context: Source, Task });
	P.Session.Messages.push({ Id: "old-answer", Role: "assistant", Text: JSON.stringify({ schemaVersion: 1, kind: "symbols", statement: "解释 $x$", hints: ["看输入"], solution: null, verification: "unverified" }) });
	const History = JSON.stringify(P.State.Sessions), ActiveId = P.State.ActiveId;
	try
	{
		assert.equal(P.Study, undefined); assert.ok(!Object.keys(P).some(Key => /Study/.test(Key)));
		await P.resend_message("old-question");
		assert.equal(JSON.stringify(P.State.Sessions), History); assert.equal(P.State.ActiveId, ActiveId);
		for(const Action of ["explain", "symbols", "expand", "check", "exercise", "feedback", "solution", "sample", "chapter", "proposal"])
		{
			assert.equal(await P.send_message("旧学习请求", Source, null, { ...Task, Action }), false);
		}
		assert.equal(F.browser_requests(), 0); assert.equal(JSON.stringify(P.State.Sessions), History);
		assert.ok(F.Notices.some(Value => /旧版学习任务.*历史/.test(Value)));
		assert.equal(Local.get("codex-sidebar-study:v1:test"), "original-private-study-records");
		await P.persist();
	}
	finally { P.onunload(); }
	const Restart = await mobile_fixture(undefined, { Files: F.Files, Local });
	try
	{
		assert.equal(JSON.stringify(Restart.Instance.State.Sessions), History);
		assert.equal(Restart.Instance.State.ActiveId, ActiveId);
		assert.equal(Local.get("codex-sidebar-study:v1:test"), "original-private-study-records");
		assert.equal(Restart.Instance.Study, undefined);
	}
	finally { Restart.Instance.onunload(); }
});

test("plugin settings own note routing and modification scope, persist choices, and keep earlier chats on restart", async () =>
{
	const F = await mobile_fixture(), P = F.Instance;
	const Original = P.State.ActiveId;
	P.Session.Messages.push({ Id: "saved-answer", Role: "assistant", Text: "原回答 $x=1$." });
	try
	{
		F.Tabs[0].display();
		const Routing = F.Settings.find(Value => Value.Name === "随笔记切换会话");
		const Scope = F.Settings.find(Value => Value.Name === "修改范围");
		assert.ok(Routing && Scope);
		assert.equal(Routing.Controls[0].Type, "toggle"); assert.equal(Routing.Controls[0].Value, true);
		assert.equal(Scope.Controls[0].Type, "dropdown"); assert.deepEqual(Object.keys(Scope.Controls[0].Options).sort(), ["ai", "captured", "note"]);
		await Routing.Controls[0].Change(false);
		await Scope.Controls[0].Change("captured");
		assert.equal(P.NoteSessions.Data.Enabled, false); assert.equal(P.State.Settings.EditScope, "captured");
		source_view(F, "new.md", "new note"); F.emit("file-open"); await P.NoteSessions.flush();
		assert.equal(P.State.ActiveId, Original); assert.equal(P.State.Sessions.length, 1);
		F.Tabs[0].display();
		assert.equal(F.Settings.find(Value => Value.Name === "随笔记切换会话").Controls[0].Value, false);
		assert.equal(F.Settings.find(Value => Value.Name === "修改范围").Controls[0].Value, "captured");
		assert.ok(F.Settings.every(Value => !/学习工作台|课程清单|学习记录/.test(Value.Name)));
		await P.persist();
	}
	finally { P.onunload(); }
	const Restart = await mobile_fixture(undefined, { Files: F.Files, Local: F.Local });
	try
	{
		assert.equal(Restart.Instance.State.Settings.EditScope, "captured"); assert.equal(Restart.Instance.NoteSessions.Data.Enabled, false);
		assert.equal(Restart.Instance.Session.Messages[0].Text, "原回答 $x=1$."); assert.equal(Restart.Instance.State.ActiveId, Original);
		await Restart.Instance.set_note_sessions(true);
		source_view(Restart, "new.md", "new note"); Restart.emit("file-open"); await Restart.Instance.NoteSessions.flush();
		assert.notEqual(Restart.Instance.State.ActiveId, Original); assert.ok(Restart.Instance.State.Sessions.some((Value: any) => Value.Id === Original));
	}
	finally { Restart.Instance.onunload(); }
});

test("loading legacy state normalizes an absent or unsupported edit range without changing chat snapshots", async () =>
{
	for(const Scope of [undefined, "all-vault", null])
	{
		const F = await mobile_fixture();
		F.Instance.Session.Messages.push({ Id: "saved", Role: "assistant", Text: "原文 $x=1$." });
		await F.Instance.persist(); F.Instance.onunload();
		const Path = `${F.Instance.manifest.dir}/remote-${F.Instance.Remote.CacheId}-state.json`, Data = JSON.parse(F.Files.get(F.Instance.RemoteStatePath)!); delete Data.SchemaVersion; Data.Settings.EditScope = Scope;
		const History = JSON.stringify(Data.Sessions), LegacyRaw = JSON.stringify(Data), LegacyFiles = new Map([[Path, LegacyRaw]]);
		const Restart = await mobile_fixture(undefined, { Files: LegacyFiles, Local: F.Local });
		try
		{
			assert.equal(Restart.Instance.State.Settings.EditScope, "ai");
			assert.equal(JSON.stringify(Restart.Instance.State.Sessions), History);
			assert.equal(LegacyFiles.get(Path), LegacyRaw, "migration keeps the original legacy file unchanged");
			assert.ok([...LegacyFiles].some(([Key, Value]) => Key.startsWith(Path + ".pre-v2-") && Value === LegacyRaw));
			assert.equal(JSON.parse(LegacyFiles.get(Restart.Instance.RemoteStatePath + ".migration.json")!).Status, "committed");
			await Restart.Instance.persist(false); assert.equal(JSON.parse(LegacyFiles.get(Restart.Instance.RemoteStatePath)!).Settings.EditScope, "ai");
		}
		finally { Restart.Instance.onunload(); }
	}
});

test("mobile PDF turns upload only owned page images, preserve source on resend and reconnect, and keep raw images outside state", async () =>
{
	const Data = "data:image/jpeg;base64," + readFileSync("examples/pdf/scanned-page.jpg").toString("base64");
	const Id = createHash("sha256").update(Data).digest("hex"), Requests: any[] = [], Cached = new Set<string>();
	const Ordinary = bootstrap_http();
	const { Instance } = await mobile_fixture(async Params =>
	{
		const Body = Params.body ? JSON.parse(Params.body) : null;
		if(Body) { Requests.push(Body); }
		if(Body?.method === "bridge/pdf-images")
		{
			if(Body.params.action === "put") { Cached.add(Body.params.id); }
			return { status: 200, json: Body.params.action === "has" ? { present: [...Cached], epoch: "fixture-epoch" } : {} };
		}
		if(Body?.method === "bridge/resume") { return { status: 200, json: null }; }
		return Ordinary(Params);
	});
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture"; Instance.Remote.Transport = "native";
	Instance.PdfImages = { get: async () => Data, clear: async () => {} };
	const Source: any = { Path: "original.pdf", Mode: "阅读", Kind: "当前位置", Text: "无文字层", SelectedText: "", Mapping: "PDF页图", Heading: "第 1 页", LineStart: null, LineEnd: null, Truncated: false, CapturedAt: "original-time", Version: "a".repeat(64), Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 3, Pages: [{ Number: 1, TextLayer: false, Image: { Id, ...jpeg_info(Data) } }] } };
	try
	{
		assert.equal(await Instance.send_message("解释扫描页", Source), true);
		const Turn = Requests.find(Value => Value.method === "turn/start");
		assert.equal(Turn.params.input.length, 3); assert.equal(Turn.params.input[1].name, "math-writing");
		assert.deepEqual(Turn.params.input[2], { type: "image", url: "obsidian-pdf:" + Id });
		assert.equal(Requests.filter(Value => Value.method === "bridge/pdf-images" && Value.params.action === "put").length, 1);
		Instance.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } } });
		const Old = Instance.Session.Messages.find((Value: any) => Value.Role === "user");
		Instance.Capture.Snapshot = { ...Source, Path: "different.pdf", CapturedAt: "later-time" };
		assert.equal(await Instance.resend_message(Old.Id), true);
		assert.equal(Instance.Session.Messages.at(-1).Context.Path, "original.pdf");
		assert.equal(Instance.Session.Messages.at(-1).Context.CapturedAt, "original-time");
		Instance.handle_message({ method: "turn/completed", params: { threadId: Instance.Session.ThreadId, turn: { id: Instance.TurnId, status: "completed" } } });
		await Instance.reconnect();
		const Replay = Requests.filter(Value => Value.method === "thread/inject_items").find(Value => Value.params.items.some((Item: any) => Item.content.some((Part: any) => Part.type === "input_image")));
		assert.ok(Replay); assert.ok(JSON.stringify(Replay).includes("original-time"));
		assert.equal(JSON.stringify(Instance.State).includes("base64"), false);
		assert.equal(Requests.filter(Value => Value.state).some(Value => JSON.stringify(Value).includes("base64")), false);
		await Instance.persist();
	}
	finally { Instance.onunload(); }
});

test("PDF sends fail before turn submission when bridge capability, original page cache or image modality is absent", async () =>
{
	const Data = "data:image/jpeg;base64," + readFileSync("examples/pdf/scanned-page.jpg").toString("base64");
	const Id = createHash("sha256").update(Data).digest("hex");
	for(const Case of ["bridge", "cache", "model"])
	{
		const Requests: any[] = [], Ordinary = bootstrap_http();
		const { Instance } = await mobile_fixture(async Params =>
		{
			const Body = Params.body ? JSON.parse(Params.body) : null;
			if(Body) { Requests.push(Body); }
			const Response = await Ordinary(Params);
			if(new URL(Params.url).pathname === "/info" && Case === "bridge") { delete Response.json.pdfPageImages; }
			if(Body?.method === "bridge/pdf-images") { Response.json = { present: [], epoch: "fixture" }; }
			if(Body?.method === "model/list" && Case === "model") { Response.json.data[0].inputModalities = ["text"]; }
			return Response;
		});
		Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
		Instance.PdfImages = { get: async () => { throw new Error("原图缺失"); } };
		const Source: any = { Path: "original.pdf", Mode: "阅读", Kind: "当前位置", Text: "无文字层", SelectedText: "", Mapping: "PDF页图", Heading: "页 1", LineStart: null, LineEnd: null, Truncated: false, CapturedAt: "original-time", Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 1, Pages: [{ Number: 1, TextLayer: false, Image: { Id, ...jpeg_info(Data) } }] } };
		try
		{
			assert.equal(await Instance.send_message("解释", Source), false);
			assert.equal(Requests.some(Value => Value.method === "turn/start"), false);
			assert.match(Instance.Status, Case === "bridge" ? /更新桥/ : Case === "cache" ? /原图缺失/ : /不支持图像/);
			const User = Instance.Session.Messages.find((Value: any) => Value.Role === "user"); assert.ok(User, "a preparation failure preserves the original question before network work");
			assert.equal(User.Context.Path, "original.pdf"); assert.equal(User.Context.CapturedAt, "original-time");
			const Op = Instance.operation_state(User.OperationId); assert.equal(Op.Status, "local"); assert.notEqual(Op.Attempted, true);
		}
		finally { Instance.onunload(); }
	}
});

test("mobile bootstrap displays received models while the following state save is pending", async () =>
{
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const { Instance } = await mobile_fixture(bootstrap_http());
	const Write = Instance.app.vault.adapter.write;
	Instance.app.vault.adapter.write = async (Path: string, Text: string) =>
	{
		if(Path === Instance.RemoteStatePath && JSON.parse(Text).Settings?.Model === "test-model")
		{
			Reached(); await Pending;
		}
		await Write(Path, Text);
	};
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	let RenderedModels = 0;
	Instance.refresh = () => { RenderedModels = Instance.Models.length; };
	const Work = Instance.ensure_connection();
	try
	{
		await Saving;
		assert.equal(Instance.Models.length, 1);
		assert.equal(RenderedModels, 1);
	}
	finally
	{
		Release(); await Work; Instance.Connection?.close();
	}
});

test("changing remote connection does not wait for an unresponsive old state sync", async () =>
{
	let Block = false;
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const { Instance, Files } = await mobile_fixture(bootstrap_http(async Params =>
	{
		if(Block && new URL(Params.url).pathname === "/state" && Params.method === "POST")
		{
			Reached(); await Pending;
		}
	}));
	Instance.Remote.Url = "https://old.test"; Instance.Remote.Token = "fixture";
	await Instance.ensure_connection();
	Instance.ensure_thread = async () => {};
	const OldPath = Instance.RemoteStatePath, OldData = Files.get(OldPath);
	Block = true;
	const Syncing = Instance.persist(); await Saving;
	let Reconfigured = false;
	const Configuring = Instance.configure_remote("https://new.test", "fixture").then(() => { Reconfigured = true; });
	try
	{
		await Promise.race([Configuring, new Promise<never>((_, Reject) => setTimeout(() => Reject(Error("new connection waited for old blocked network sync")), 250))]);
		assert.equal(Reconfigured, true);
		assert.equal(Instance.Remote.Url, "https://new.test");
		assert.ok(Files.has(OldPath));
		assert.notEqual(Instance.RemoteStatePath, OldPath); assert.ok(Files.has(Instance.RemoteStatePath));
		assert.equal(Files.get(OldPath), OldData, "late old synchronization does not overwrite either scope");
	}
	finally
	{
		Release(); await Syncing; await Configuring; Instance.Connection?.close();
	}
});

test("mobile network errors identify the failed operation without including credentials or body", async () =>
{
	const { Instance } = await mobile_fixture(async () => { throw new Error("请求超时"); });
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "private-fixture-token";
	await assert.rejects(Instance.remote_http("/rpc", "POST", { method: "model/list", params: { private: "private-fixture-body" } }), ErrorValue =>
	{
		const Message = (ErrorValue as Error).message;
		assert.match(Message, /远程 POST model\/list: 请求超时/);
		assert.ok(!Message.includes(Instance.Remote.Token));
		assert.ok(!Message.includes("private-fixture-body"));
		return true;
	});
});

test("a pending session state upload reports its preparation stage before any turn is submitted", async () =>
{
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const Operations: string[] = [];
	const { Instance } = await mobile_fixture(bootstrap_http(async Params =>
	{
		if(Params.body?.includes('"method"')) Operations.push(JSON.parse(Params.body).method);
		if(new URL(Params.url).pathname === "/state" && Params.method === "POST")
		{
			Reached(); await Pending;
		}
	}));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	await Instance.ensure_connection();
	const Sending = Instance.send_message("fixture question", null);
	try
	{
		await Saving;
		assert.equal(Instance.Activity, "保存会话");
		assert.ok(!Operations.includes("turn/start"));
	}
	finally
	{
		Release(); await Sending; Instance.Connection?.close();
	}
});

test("session deletion persists only the reviewed chat removal, keeps edit records, and survives reopening", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, Id = P.Session.Id;
	P.Session.Messages.push({ Id: "original-user", Role: "user", Text: "Original deletion fixture" });
	const Edits = P.Edits.Store.export_records(), Settings = JSON.stringify(P.State.Settings), Stamp = session_stamp(P.Session);
	await P.delete_session(Id, Stamp);
	assert.ok(!P.State.Sessions.some((S: any) => S.Id === Id)); assert.ok(P.State.Sessions.length); assert.deepEqual([...P.State.DeletedSessionIds], [Id]);
	assert.equal(P.Edits.Store.export_records(), Edits); assert.equal(JSON.stringify(P.State.Settings), Settings);
	const Saved = JSON.parse(F.Files.get(P.RemoteStatePath)!); assert.ok(!Saved.Sessions.some((S: any) => S.Id === Id)); assert.deepEqual(Saved.DeletedSessionIds, [Id]);
	P.onunload();
	const Restored = await mobile_fixture(undefined, { Files: F.Files, Local: F.Local });
	try { assert.ok(!Restored.Instance.State.Sessions.some((S: any) => S.Id === Id)); assert.deepEqual([...Restored.Instance.State.DeletedSessionIds], [Id]); }
	finally { Restored.Instance.onunload(); }
});

test("failed storage, a stale dialog, busy work and unsent drafts cannot delete session history", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, Id = P.Session.Id;
	P.Session.Messages.push({ Id: "original-user", Role: "user", Text: "Original deletion fixture" });
	const Stamp = session_stamp(P.Session); P.Session.Messages[0].Text += " changed";
	await assert.rejects(P.delete_session(Id, Stamp), /已变化/);
	P.Busy = true; await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /正在(?:回复|准备、回复或核对提交)/); P.Busy = false;
	P.NoteSessions.Switching = true; await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /切换笔记/); P.NoteSessions.Switching = false;
	P.Connecting = Promise.resolve(); await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /正在连接/); P.Connecting = null;
	const View = F.Views.get("codex-sidebar-view")!({}); View.Input = { value: "Original unsent draft" }; P.app.workspace.getLeavesOfType = () => [{ view: View }];
	await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /草稿/); P.app.workspace.getLeavesOfType = () => [];
	const Before = JSON.stringify(P.State), Links = JSON.stringify(P.NoteSessions.Data);
	P.app.vault.adapter.write = async () => { throw new Error("original storage failure"); };
	await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /original storage failure/);
	assert.equal(JSON.stringify(P.State), Before); assert.equal(JSON.stringify(P.NoteSessions.Data), Links); assert.equal(P.SessionDeleting, false); P.onunload();
});

test("deletion serializes with other saves, rejects duplicate actions and never lets an old queued snapshot restore the chat", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, Id = P.Session.Id, Write = P.app.vault.adapter.write;
	let Release!: () => void; const Wait = new Promise<void>(R => Release = R);
	P.app.vault.adapter.write = async (...Args: any[]) => { await Wait; return Write(...Args); };
	const Removing = P.delete_session(Id, session_stamp(P.Session)); await new Promise(R => setTimeout(R, 0));
	assert.equal(P.SessionDeleting, true); assert.ok(P.State.Sessions.some((S: any) => S.Id === Id));
	await assert.rejects(P.delete_session(Id, session_stamp(P.Session)), /正在删除/);
	assert.equal(await P.send_chat("Original question", null, null), false);
	P.State.Settings.Model = "original-updated-model"; const Saving = P.persist(false); Release();
	await Promise.all([Removing, Saving]);
	const Saved = JSON.parse(F.Files.get(P.RemoteStatePath)!); assert.ok(!Saved.Sessions.some((S: any) => S.Id === Id)); assert.equal(Saved.Settings.Model, "original-updated-model"); assert.equal(P.SessionDeleting, false); P.onunload();
});

test("a stale remote snapshot cannot revive an offline-deleted chat on reconnect", async () =>
{
	let Stale: any; const Ordinary = bootstrap_http(), Methods: string[] = [];
	const F = await mobile_fixture(async Params =>
	{
		if(Params.body) { const Body = JSON.parse(Params.body); if(Body.method) { Methods.push(Body.method); } }
		if(new URL(Params.url).pathname === "/state" && Params.method === "GET") { return { status: 200, json: { state: structuredClone(Stale), cursor: 0 } }; }
		return Ordinary(Params);
	});
	const P = F.Instance; P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	const Id = P.Session.Id; P.Session.Messages.push({ Id: "original-user", Role: "user", Text: "Original offline deletion fixture" });
	Stale = JSON.parse(JSON.stringify(P.State)); await P.delete_session(Id, session_stamp(P.Session));
	try
	{
		await P.ensure_connection(); assert.ok(!P.State.Sessions.some((S: any) => S.Id === Id)); assert.ok(P.State.DeletedSessionIds.includes(Id));
		assert.ok(!JSON.parse(F.Files.get(P.RemoteStatePath)!).Sessions.some((S: any) => S.Id === Id)); assert.ok(!Methods.includes("turn/start"));
	}
	finally { P.onunload(); }
});

test("deleting a note-bound conversation installs a stable empty replacement without modifying other chats or records", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, Id = P.Session.Id;
	P.Session.Messages.push({ Id: "original-user", Role: "user", Text: "Original bound deletion" });
	P.NoteSessions.set_enabled(false); P.NoteSessions.observe("Original.md"); P.NoteSessions.bind_current(); P.NoteSessions.set_enabled(true); await P.NoteSessions.flush();
	const Edits = P.Edits.Store.export_records(); await P.delete_session(Id, session_stamp(P.Session));
	const Replacement = P.State.ActiveId; assert.notEqual(Replacement, Id); assert.equal(P.Session.Title, "Original"); assert.equal(P.Session.Messages.length, 0);
	assert.equal(P.NoteSessions.Data.Links.find((L: any) => L.Path === "Original.md").SessionId, Replacement); assert.equal(P.Edits.Store.export_records(), Edits);
	P.NoteSessions.observe("Other.md"); await P.NoteSessions.flush(); P.NoteSessions.observe("Original.md"); await P.NoteSessions.flush();
	assert.equal(P.State.ActiveId, Replacement); assert.ok(!P.State.Sessions.some((S: any) => S.Id === Id)); P.onunload();
});

test("remote state-sync failure preserves a locally committed deletion and reports the incomplete remote sync", async () =>
{
	let Fail = false; const Ordinary = bootstrap_http();
	const F = await mobile_fixture(async Params => { if(Fail && new URL(Params.url).pathname === "/state" && Params.method === "POST") { throw new Error("Original offline fixture"); } return Ordinary(Params); });
	const P = F.Instance; P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	try
	{
		await P.ensure_connection(); const Id = P.Session.Id, Stamp = session_stamp(P.Session); Fail = true;
		await P.delete_session(Id, Stamp); assert.ok(!P.State.Sessions.some((S: any) => S.Id === Id)); assert.ok(P.State.DeletedSessionIds.includes(Id));
		assert.ok(!JSON.parse(F.Files.get(P.RemoteStatePath)!).Sessions.some((S: any) => S.Id === Id)); assert.ok(F.Notices.some(N => N.includes("远程同步尚未完成")));
	}
	finally { P.onunload(); }
});

test("edit retention setting is device-local, defaults to one and persists never across restart", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, State = JSON.stringify(P.State);
	F.Tabs[0].display(); const Setting = F.Settings.find(S => S.Name === "修改与还原缓存保留轮数");
	assert.ok(Setting); assert.equal(Setting.Controls[0].Value, "1"); await Setting.Controls[0].Change("3"); assert.equal(P.Edits.Cache.Turns, 3);
	await Setting.Controls[0].Change("bad"); assert.equal(P.Edits.Cache.Turns, 3); await Setting.Controls[0].Change("永不"); assert.equal(P.Edits.Cache.Turns, 0);
	assert.equal(JSON.stringify(P.State), State); await P.Edits.Store.close(); P.onunload();
	const G = await mobile_fixture(undefined, { Files: F.Files, Local: F.Local });
	try { G.Tabs[0].display(); assert.equal(G.Settings.find(S => S.Name === "修改与还原缓存保留轮数").Controls[0].Value, "永不"); }
	finally { G.Instance.onunload(); }
});

test("actual plugin cache context counts completed dialogue once and excludes interruption, reasoning and other scopes", async () =>
{
	const F = await mobile_fixture(), P = F.Instance, Id = P.Session.Id;
	P.Session.Messages.push({ Id: "u", Role: "user", Text: "Original", TurnId: "t1", CompletionStatus: "completed" }, { Id: "a", Role: "assistant", Text: "Original", TurnId: "t1", CompletionStatus: "completed" }, { Id: "stop", Role: "assistant", Text: "Original", TurnId: "t2", CompletionStatus: "interrupted" }, { Id: "r", Role: "reasoning", Text: "Original", TurnId: "t3", CompletionStatus: "completed" });
	const C = P.edit_cache_context(); assert.deepEqual([...C.Turns], ["t1"]);
	assert.equal(P.edit_cache_context(JSON.stringify(["desktop", Id])), null);
	P.Session.ThreadId = "fixture-thread";
	P.handle_message({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "t2", status: "failed" } } });
	assert.deepEqual([...P.edit_cache_context().Turns], ["t1"]); P.onunload();
});

test("a locally saved new question survives upload failure, read-only recovery and a fresh plugin instance without automatic inference", async () =>
{
	let FailUpload = true; const Requests: any[] = [], Ordinary = bootstrap_http();
	const Http = async (Params: any) =>
	{
		if(Params.body) { Requests.push(JSON.parse(Params.body)); }
		if(FailUpload && new URL(Params.url).pathname === "/state" && Params.method === "POST") { throw Error("fixture upload offline"); }
		return Ordinary(Params);
	};
	const F = await mobile_fixture(Http), P = F.Instance;
	P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	const Context = { Path: "Original.md", Mode: "阅读", Kind: "选区", Text: "固定 $X$, 定义 $[X,Y]=XY-YX$.", SelectedText: "$[X,Y]$", Mapping: "源块", Heading: "交换子", LineStart: 0, LineEnd: 0, Truncated: false, CapturedAt: "original-capture" };
	let Message: any;
	try
	{
		assert.equal(await P.send_chat("解释线性这一步", Context, null), false);
		Message = structuredClone(P.Session.Messages.find((M: any) => M.Role === "user")); assert.ok(Message.OperationId);
		assert.equal(Message.Context.Text, Context.Text); assert.equal(P.operation_state(Message.OperationId).Status, "local");
		assert.equal(Requests.filter(R => R.method === "turn/start").length, 0);
		const Saved = JSON.parse(F.Files.get(P.RemoteStatePath)!); assert.equal(Saved.Sessions.find((S: any) => S.Id === P.Session.Id).Messages[0].Prompt, Message.Prompt);
		FailUpload = false; await P.reconnect();
		assert.equal(P.Session.Messages.find((M: any) => M.Id === Message.Id).Prompt, Message.Prompt); assert.equal(P.operation_state(Message.OperationId).Status, "local");
		assert.equal(Requests.filter(R => R.method === "turn/start").length, 0); await P.persist(false);
	}
	finally { P.onunload(); }
	const R = await mobile_fixture(Http, { Files: F.Files, Local: F.Local });
	try
	{
		const Restored = R.Instance.Session.Messages.find((M: any) => M.Id === Message.Id);
		assert.equal(Restored.OperationId, Message.OperationId); assert.equal(Restored.Prompt, Message.Prompt); assert.equal(JSON.stringify(Restored.Context), JSON.stringify(Context));
		assert.equal(R.Instance.operation_state(Message.OperationId).Status, "local"); await R.Instance.ensure_connection();
		assert.equal(Requests.filter(Q => Q.method === "turn/start").length, 0); assert.equal(R.Instance.Session.Messages.filter((M: any) => M.Id === Message.Id).length, 1);
	}
	finally { R.Instance.onunload(); }
});

test("cancelling connection preparation preserves the actual composer draft, quote and saved intent while late metadata cannot submit", async () =>
{
	const Gate = deferred(), Reached = deferred(), Requests: any[] = [], Ordinary = bootstrap_http();
	const F = await mobile_fixture(async Params =>
	{
		if(Params.body) { Requests.push(JSON.parse(Params.body)); }
		if(new URL(Params.url).pathname === "/info") { Reached.resolve(); await Gate.Promise; }
		return Ordinary(Params);
	}), P = F.Instance, View = F.Views.get("codex-sidebar-view")!({});
	P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	const Quote = { SessionId: P.Session.Id, MessageId: "original-answer", SelectedText: "核对分配律", SourceText: "固定 X, 展开交换子并核对加法及数乘.", SelectedTruncated: false, SourceTruncated: false };
	P.AnswerQuote = Quote; View.Input = { value: "展开这一步" }; View.refresh_quote = () => {};
	const Sending = View.send_input("question");
	try
	{
		await Reached.Promise; assert.equal(P.CanStop, true); await P.stop_turn(); await Sending;
		assert.equal(View.Input.value, "展开这一步"); assert.equal(P.AnswerQuote, Quote);
		const User = P.Session.Messages.find((M: any) => M.Role === "user"); assert.ok(User); assert.equal(P.operation_state(User.OperationId).Status, "cancelled");
		Gate.resolve(); await wait_until(() => !P.Connecting, "late metadata completes only its read-only connection work");
		assert.equal(Requests.filter(R => R.method === "turn/start").length, 0); assert.equal(View.Input.value, "展开这一步"); assert.equal(P.AnswerQuote, Quote);
		const Draft = JSON.parse(F.Local.get(View.DraftStore.Key)!); assert.equal(Draft.Text, "展开这一步"); assert.equal(Draft.Quote.SourceText, Quote.SourceText);
	}
	finally { Gate.resolve(); await Sending; P.onunload(); }
});

test("a lost turn receipt remains unknown across reconnect and restart and cannot be explicitly resumed as an unattempted send", async () =>
{
	let Submissions = 0, SavedAtPost: any, Fixture: Awaited<ReturnType<typeof mobile_fixture>>; const Ordinary = bootstrap_http();
	const Http = async (Params: any) =>
	{
		const Request = Params.body ? JSON.parse(Params.body) : null;
		if(Request?.method === "turn/start") { Submissions++; SavedAtPost = JSON.parse(Fixture.Files.get(Fixture.Instance.RemoteStatePath)!).Sync.Operations.find((O: any) => O.Id === Request.id); throw Error("fixture response lost after submission"); }
		return Ordinary(Params);
	};
	const F = await mobile_fixture(Http), P = F.Instance; P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	Fixture = F;
	let Id = "", Prompt = "";
	try
	{
		assert.equal(await P.send_chat("核对 $[X,X]=0$", null, null), true, "unknown submission is accepted locally, never reported as not sent");
		const Message = P.Session.Messages.find((M: any) => M.Role === "user"); Id = Message.OperationId; Prompt = Message.Prompt;
		assert.equal(P.operation_state(Id).Status, "submission-unknown"); assert.equal(P.operation_state(Id).Attempted, true); assert.equal(Submissions, 1);
		assert.equal(SavedAtPost.Attempted, true, "attempt marker must be durable before the transport receives turn/start"); assert.equal(SavedAtPost.Status, "submission-unknown"); assert.equal(SavedAtPost.Request.input[0].text, Prompt);
		P.handle_message({ method: "bridge/recovering", params: { message: "核对已提交操作" } }); assert.equal(P.RuntimeState.Stage, "recovering");
		await assert.rejects(P.stop_turn(), /旧桥不支持操作状态查询/); assert.equal(P.operation_state(Id).Status, "submission-unknown"); assert.equal(P.operation_state(Id).Attempted, true); assert.equal(Submissions, 1);
		assert.ok(!F.Notices.some(N => /准备已取消/.test(N))); P.handle_message({ method: "bridge/recovered", params: {} }); assert.equal(P.RuntimeState.Stage, "submission-unknown");
		await P.reconnect(); assert.equal(Submissions, 1); await assert.rejects(P.resume_operation(Id), /未知|盲目/); await P.persist(false);
	}
	finally { P.onunload(); }
	const R = await mobile_fixture(Http, { Files: F.Files, Local: F.Local });
	try
	{
		assert.equal(R.Instance.operation_state(Id).Status, "submission-unknown"); assert.equal(R.Instance.Session.Messages.find((M: any) => M.OperationId === Id).Prompt, Prompt);
		await R.Instance.ensure_connection(); await assert.rejects(R.Instance.resume_operation(Id), /未知|盲目/); assert.equal(Submissions, 1);
	}
	finally { R.Instance.onunload(); }
});

test("an unloaded old scope stores its late turn receipt separately and never changes a newly opened connection scope", async () =>
{
	const Gate = deferred(), Reached = deferred(), Ordinary = bootstrap_http(); let Submissions = 0;
	const Http = async (Params: any) =>
	{
		if(Params.body && JSON.parse(Params.body).method === "turn/start") { Submissions++; Reached.resolve(); await Gate.Promise; }
		return Ordinary(Params);
	};
	const F = await mobile_fixture(Http), P = F.Instance; P.Remote.Url = "https://old.test"; P.Remote.Token = "fixture";
	const Sending = P.send_chat("原连接问题", null, null); await Reached.Promise;
	const OldPath = P.RemoteStatePath, OldConfig = F.Local.get("codex-sidebar-remote:test")!, User = structuredClone(P.Session.Messages.find((M: any) => M.Role === "user"));
	P.onunload(); await Sending;
	const OldRaw = F.Files.get(OldPath), Config = JSON.parse(OldConfig); Config.CacheId = randomUUID(); Config.Url = "https://new.test"; Config.Server = ""; Config.Cursor = 0; F.Local.set("codex-sidebar-remote:test", JSON.stringify(Config));
	const Current = await mobile_fixture(Http, { Files: F.Files, Local: F.Local }), B = Current.Instance;
	try
	{
		B.Session.Messages.push({ Id: "new-scope-question", Role: "user", Text: "新连接本机记录" }); await B.persist(false);
		const NewRaw = F.Files.get(B.RemoteStatePath), NewState = JSON.stringify(B.State); Gate.resolve();
		await wait_until(() => [...F.Files].some(([K, V]) => K.startsWith(OldPath + ".receipt-") && JSON.parse(V).Record?.TurnId === "fixture-turn"), "old receipt is retained under its original canonical path");
		assert.equal(F.Files.get(B.RemoteStatePath), NewRaw); assert.equal(JSON.stringify(B.State), NewState); assert.equal(F.Files.get(OldPath), OldRaw); assert.equal(Submissions, 1);
	}
	finally { Gate.resolve(); B.onunload(); }
	F.Local.set("codex-sidebar-remote:test", OldConfig);
	const Restored = await mobile_fixture(Http, { Files: F.Files, Local: F.Local });
	try
	{
		const Original = Restored.Instance.Session.Messages.find((M: any) => M.Id === User.Id); assert.equal(Original.Prompt, User.Prompt); assert.equal(Original.TurnId, "fixture-turn");
		assert.equal(Restored.Instance.operation_state(User.OperationId).TurnId, "fixture-turn"); assert.equal(Submissions, 1);
	}
	finally { Restored.Instance.onunload(); }
});

test("background events and duplicate versioned checkpoints stay in their original session and old completion cannot stop a newer turn", async () =>
{
	const Requests: any[] = [], F = await mobile_fixture(bootstrap_http(async Params => { if(Params.body) { Requests.push(JSON.parse(Params.body)); } })), P = F.Instance;
	P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	try
	{
		assert.equal(await P.send_chat("解释交换子的线性", null, null), true);
		const A = P.Session, ThreadId = A.ThreadId, TurnId = P.TurnId, OperationId = A.Messages[0].OperationId;
		const B = { Id: "other-session", Title: "另一个会话", ThreadId: null, Messages: [{ Id: "b-original", Role: "user", Text: "保持本会话" }] }; P.State.Sessions.push(B); P.State.ActiveId = B.Id; P.restore_runtime();
		const BBefore = JSON.stringify(B), VisibleStatus = P.Status;
		P.handle_message({ method: "item/agentMessage/delta", params: { threadId: ThreadId, turnId: TurnId, itemId: "a-answer", delta: "固定 X" } });
		const Checkpoint = { Id: "a-answer", Role: "assistant", TurnId, Text: "固定 X 后, 展开 $[X,Y+Z]$ 核对线性.", CompletionStatus: "completed", SyncVersion: { Revision: 2, Digest: createHash("sha256").update("original complete checkpoint").digest("hex"), Origin: "original-bridge" } };
		for(let I = 0; I < 2; I++) { P.handle_message({ method: "bridge/message-updated", params: { threadId: ThreadId, sessionId: A.Id, message: Checkpoint } }); }
		P.handle_message({ method: "bridge/message-updated", params: { threadId: ThreadId, sessionId: A.Id, message: { ...Checkpoint, Text: "旧部分稿", CompletionStatus: undefined, SyncVersion: { ...Checkpoint.SyncVersion, Revision: 1 } } } });
		assert.equal(A.Messages.filter((M: any) => M.Id === Checkpoint.Id).length, 1); assert.equal(A.Messages.find((M: any) => M.Id === Checkpoint.Id).Text, Checkpoint.Text);
		const Completed = { method: "turn/completed", params: { threadId: ThreadId, turn: { id: TurnId, status: "completed" } } };
		P.handle_message(Completed); P.handle_message(Completed);
		assert.equal(JSON.stringify(B), BBefore); assert.equal(P.Status, VisibleStatus); assert.equal(P.Busy, false); assert.equal(P.operation_state(OperationId).Status, "completed");
		assert.deepEqual([...P.edit_cache_context(JSON.stringify([P.Remote.CacheId, A.Id])).Turns], [TurnId]);
		P.State.ActiveId = A.Id; P.restore_runtime(); assert.equal(await P.send_chat("继续说明齐次性", null, null), true, JSON.stringify({ Status: P.Status, Runtime: P.RuntimeState, Busy: P.Busy, Switching: P.NoteSessions?.Switching, Operations: P.State.Sync?.Operations.map((O: any) => ({Id:O.Id,Status:O.Status,Conflicts:O.Conflicts?.map((C: any) => C.Reason)})) }));
		const NewTurn = P.TurnId; assert.notEqual(NewTurn, TurnId); assert.equal(P.Busy, true);
		P.handle_message(Completed); assert.equal(P.TurnId, NewTurn, "a duplicate old completion must not clear the active newer turn"); assert.equal(P.Busy, true); assert.equal(P.RuntimeState.Stage, "generating");
		assert.equal(Requests.filter(R => R.method === "turn/start").length, 2); await P.SaveQueue;
	}
	finally { P.onunload(); }
});

test("cancelling during real protocol2 input-blob chunks stops remaining chunks and never reaches inference submission", async () =>
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-mobile-chunk-original-")), Skill = join(Directory, "SKILL.md"), Token = "original-mobile-test-".repeat(3); writeFileSync(Skill, "Original integration acceptance skill");
	let Submits = 0; const Gate = deferred(), Reached = deferred(), Posts: any[] = [];
	const Bridge = new RemoteBridge({ Port: 0, Cli: "mock", Cwd: Directory, Vault: "test", ObsidianCli: "mock", StateDir: join(Directory, "state"), Clients: [{ Id: "original-mobile", Hash: token_hash(Token) }] }, () => ({
		async request(Method: string)
		{
			if(Method === "account/read") { return { account: { type: "chatgpt" } }; }
			if(Method === "model/list") { return { data: [{ model: "original-model", displayName: "Original", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: null }; }
			if(Method === "skills/list") { return { data: [{ cwd: Directory, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] }; }
			if(Method === "thread/start") { return { model: "original-model", thread: { id: "original-chunk-thread", ephemeral: true, path: null, turns: [] } }; }
			if(Method === "turn/start") { Submits++; return { turn: { id: "original-chunk-turn", status: "inProgress" } }; }
			return {};
		}, send() {}, close() {}
	}));
	const Port = await Bridge.listen(); let F: Awaited<ReturnType<typeof mobile_fixture>> | undefined, InputId = "";
	try
	{
		F = await mobile_fixture(async Params =>
		{
			const Path = new URL(Params.url).pathname, Body = Params.body ? JSON.parse(Params.body) : null;
			if(Body) { Posts.push({ Path, Body }); }
			if(Path === "/sync/blob" && Body?.index === 0 && F?.Instance.State.Sync?.Operations[0])
			{
				InputId = await content_digest(F.Instance.State.Sync.Operations[0].Input);
				if(Body.id === InputId) { assert.ok(Body.count > 1); Reached.resolve(); await Gate.Promise; }
			}
			const Response = await fetch(`http://127.0.0.1:${Port}${new URL(Params.url).pathname}${new URL(Params.url).search}`, { method: Params.method, headers: { Authorization: "Bearer " + Token }, ...(Params.body ? { body: Params.body } : {}) });
			return { status: Response.status, json: await Response.json() };
		});
		const P = F.Instance; P.Remote.Url = "https://fixture.test"; P.Remote.Token = Token; P.Remote.Transport = "native";
		P.Session.EffectiveModel = "original-model"; P.Session.Usage = { modelContextWindow: 800000 };
		const Sending = P.send_chat("原创交换子算例. ".repeat(3200), null, null);
		try
		{
			await Promise.race([Reached.Promise, Sending.then(() => { throw Error("input upload did not reach a multi-chunk operation: " + P.Status); })]);
			assert.equal(P.RuntimeState.Stage, "preparing"); await P.stop_turn(); await Sending;
			const User = P.Session.Messages.find((M: any) => M.Role === "user"); assert.equal(P.operation_state(User.OperationId).Status, "cancelled"); assert.equal(P.operation_state(User.OperationId).Attempted, false);
			Gate.resolve(); await new Promise(R => setTimeout(R, 30));
			assert.equal(Posts.filter(Q => Q.Path === "/sync/blob" && Q.Body.id === InputId).length, 1); assert.equal(Posts.filter(Q => Q.Path === "/operations").length, 0); assert.equal(Submits, 0);
			const Saved = JSON.parse(F.Files.get(P.RemoteStatePath)!); assert.equal(Saved.Sessions.find((S: any) => S.Id === P.Session.Id).Messages.find((M: any) => M.Id === User.Id).Prompt, User.Prompt);
		}
		finally { Gate.resolve(); await Sending; P.onunload(); }
	}
	finally { Gate.resolve(); F?.Instance.Connection?.close(); await Bridge.close(); assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); }
});

test("returning to a conversation with an unknown submission restores its pending runtime instead of permitting another turn", async () =>
{
	let Submissions = 0; const Ordinary = bootstrap_http(), F = await mobile_fixture(async Params =>
	{
		if(Params.body && JSON.parse(Params.body).method === "turn/start") { Submissions++; throw Error("original unknown receipt"); }
		return Ordinary(Params);
	}), P = F.Instance; P.Remote.Url = "https://example.test"; P.Remote.Token = "fixture";
	try
	{
		assert.equal(await P.send_chat("原未知问题", null, null), true); const Id = P.Session.Id, OperationId = P.Session.Messages[0].OperationId;
		await P.choose_session(); assert.notEqual(P.Session.Id, Id); assert.equal(P.RuntimeState.Stage, "idle");
		await P.choose_session(Id); assert.equal(P.operation_state(OperationId).Status, "submission-unknown");
		assert.equal(P.RuntimeState.Stage, "submission-unknown", "choosing the old session must restore its operation-derived state");
		assert.equal(await P.send_chat("不能在未知旧回合上再提交", null, null), false); assert.equal(Submissions, 1); assert.equal(P.Session.Messages.filter((M: any) => M.Role === "user").length, 1);
	}
	finally { P.onunload(); }
});
