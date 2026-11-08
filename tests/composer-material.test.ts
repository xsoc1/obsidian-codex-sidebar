import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import type { ContextSnapshot } from "../src/prompt";
import { answer_quote } from "../src/quote";
import { build_prompt } from "../src/prompt";
import { resolve_material, combine_pdf_image } from "../src/composer-material";
import { message_pdf_refs } from "../src/pdf/inputs";
import { markdown_blocks, text_identity } from "../src/markdown-blocks";
import { ReadingNavigation } from "../src/reading-navigation";

const Snapshot: ContextSnapshot = { Path: "conditions.pdf", Mode: "阅读", Kind: "选区", Mapping: "PDF页图", Text: "new conditions", SelectedText: "", LineStart: null, LineEnd: null, Heading: "", CapturedAt: "capture", Truncated: false, Version: "v1" };
const Quote = answer_quote("session", "answer", "x", "Original $x$ argument");
function fixture(Data = new Map<string, string>())
{
	const Bundle = buildSync({ entryPoints: ["src/view.ts"], bundle: true, write: false, platform: "browser", format: "cjs", external: ["obsidian"] }).outputFiles[0].text;
	const Module = { exports: {} as any }, Notices: string[] = [];
	class Base {}
	runInNewContext(Bundle, { module: Module, exports: Module.exports, structuredClone, TextEncoder, setTimeout, clearTimeout, localStorage: { getItem: (K: string) => Data.get(K) ?? null, setItem: (K: string, V: string) => Data.set(K, V) }, require: () => ({ ItemView: Base, Modal: Base, Component: Base, Notice: class { constructor(T: string) { Notices.push(T); } } }) });
	const V: any = Object.create(Module.exports.CodexView.prototype);
	V.Owner = { Session: { Id: "session" }, Capture: { Snapshot: structuredClone(Snapshot), Pdf: { verify_snapshot: async () => {} }, clear() { this.Snapshot = null as any; } }, State: { Settings: { AttachContext: true } }, AnswerQuote: structuredClone(Quote), draft_scope: () => "scope", refresh() {} };
	V.Owner.clear_context = () => V.Owner.Capture.clear();
	V.refresh = () => {}; V.refresh_quote = () => {}; V.refresh_draft_status = () => {};
	V.Input = { value: "" }; V.DraftStore = null; V.DraftRevision = 0; V.DraftMaterial = { Context: null, Quote: null };
	V.ReadingNavigation = new ReadingNavigation(); V.RenderingDone = Promise.resolve(); V.MountedReading = null;
	return { V, Notices, Data };
}

test("an explicit new attachment and an old answer quote resolve together, while automatic snapshots do not", () =>
{
	const { V } = fixture();
	assert.equal(V.current_material().Context, null);
	V.accept_attachment?.(Snapshot, "scope", "session");
	assert.deepEqual(JSON.parse(JSON.stringify(V.current_material().Context)), Snapshot);
	assert.deepEqual(JSON.parse(JSON.stringify(V.current_material().Quote)), Quote);
});

test("quote plus explicit PDF survives empty-input save, restart and send with the same prompt and image references", async () =>
{
	const Original: ContextSnapshot = { ...Snapshot, Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [{ Number: 3, TextLayer: false, Image: { Id: "a".repeat(64), Width: 100, Height: 100, Bytes: 100 } }] } };
	const First = fixture(); First.V.sync_draft(); assert.equal(First.V.accept_attachment(Original, "scope", "session"), true);
	const Stored = First.V.DraftStore.load(); assert.equal(Stored.ContextOrigin, "explicit"); assert.equal(Stored.Text, "");
	const Next = fixture(First.Data), V = Next.V; V.Owner.Capture.Snapshot = { ...Snapshot, Path: "unrelated.pdf" }; V.Owner.AnswerQuote = null; V.sync_draft();
	assert.equal(V.DraftRestore, true); V.restore_material(V.DraftMaterial); V.DraftRestore = false;
	assert.equal(V.current_material().Context.Path, "conditions.pdf"); assert.equal(V.current_material().Quote.MessageId, "answer");
	V.Input.value = "沿原路线解释新条件"; V.save_draft();
	let Sent: any; V.Owner.send_chat = async (Text: string, Context: ContextSnapshot, Q: any, Options: any) => { Sent = { Text, Context, Quote: Q, Options, Prompt: build_prompt(Text, Context, Q) }; return true; };
	const Before = JSON.parse(JSON.stringify(V.current_material())); await V.send_input("chat");
	assert.deepEqual(JSON.parse(JSON.stringify(Sent.Context)), Before.Context); assert.deepEqual(JSON.parse(JSON.stringify(Sent.Quote)), Before.Quote);
	assert.equal(Sent.Options.MaterialOrigin, "explicit"); assert.deepEqual(message_pdf_refs(Sent).map(R => R.Id), ["a".repeat(64)]);
	assert.match(Sent.Prompt, /new conditions/); assert.match(Sent.Prompt, /Original \$x\$ argument/); assert.equal(V.Input.value, "");
});

test("late captures do not cross scope/session and clear context and cancel quote are independent", () =>
{
	const { V } = fixture(); V.accept_attachment(Snapshot, "scope", "session");
	V.Owner.AnswerQuote = null; assert.equal(V.current_material().Context.Path, Snapshot.Path);
	V.Owner.AnswerQuote = structuredClone(Quote); V.clear_material(); assert.equal(V.current_material().Context, null); assert.equal(V.current_material().Quote.MessageId, Quote.MessageId);
	V.Owner.Session.Id = "next"; V.Owner.AnswerQuote = null; V.Owner.Capture.Snapshot = Snapshot;
	assert.equal(V.accept_attachment(Snapshot, "scope", "session"), false); assert.equal(V.current_material().Context, null);
	V.Owner.Session.Id = "session"; V.accept_attachment(Snapshot, "scope", "session"); V.Owner.draft_scope = () => "other-backend";
	assert.equal(V.current_material().Context, null); assert.equal(V.accept_attachment(Snapshot, "scope", "session"), false);
});

test("failed original-image/source verification retains the exact draft and never sends a substitute", async () =>
{
	const { V } = fixture(); V.sync_draft(); V.accept_attachment({ ...Snapshot, PdfTarget: { Kind: "rect", Page: 1, Values: [1, 2, 3, 4] } } as any, "scope", "session"); V.Input.value = "keep input"; V.save_draft();
	let Sent = 0; V.Owner.send_chat = async () => { Sent++; return true; }; V.Owner.Capture.Pdf.verify_snapshot = async () => { throw Error("原图缺失 fixture"); };
	await V.send_input("chat"); assert.equal(Sent, 0); assert.equal(V.Input.value, "keep input"); assert.equal(V.DraftStore.load().Context.Path, Snapshot.Path); assert.match(V.DraftError, /原图缺失/);
});

test("attachment verification rechecks composer identity after awaiting the PDF reader", async () =>
{
	const { V } = fixture(); V.sync_draft(); V.accept_attachment({ ...Snapshot, PdfTarget: { Kind: "rect", Page: 1, Values: [1, 2, 3, 4] } } as any, "scope", "session"); V.Input.value = "question";
	let Resume!: () => void, Sent = 0; V.Owner.Capture.Pdf.verify_snapshot = () => new Promise<void>(R => Resume = R); V.Owner.send_chat = async () => { Sent++; return true; };
	const Sending = V.send_input("chat"); V.Owner.Session.Id = "other"; Resume(); await Sending; assert.equal(Sent, 0); assert.equal(V.Input.value, "question");
});

test("the material resolver never infers explicit intent from a current snapshot", () =>
{
	const Base = { Scope: "s", SessionId: "session", AttachContext: true, Automatic: Snapshot, Attachment: null, Quote };
	assert.equal(resolve_material(Base).Context, null);
	assert.equal(resolve_material({ ...Base, Quote: null }).Context, Snapshot);
	assert.equal(resolve_material({ ...Base, Attachment: { Scope: "wrong", SessionId: "session", Snapshot } }).Context, null);
	assert.equal(resolve_material({ ...Base, AttachContext: false, Attachment: { Scope: "s", SessionId: "session", Snapshot } }).Context, null);
});

test("same-page PDF combination preserves original text target, independent rotation metadata and the two-image ceiling", () =>
{
	const Selection: ContextSnapshot = { ...Snapshot, Mapping: "PDF文本层", SelectedText: "原文字 θ", Text: "", PdfTarget: { Kind: "text", Page: 3, Selection: [0, 0, 0, 5] } as any };
	const Region = { X: 0, Y: 0, Width: 0.5, Height: 0.5, PageWidth: 200, PageHeight: 100, Scale: 1, Rotation: 90 };
	const Image: ContextSnapshot = { ...Snapshot, Pdf: { schemaVersion: 2, ReadOnly: true, PageCount: 4, Pages: [{ Number: 3, TextLayer: false, Kind: "region", Region, Image: { Id: "b".repeat(64), Width: 100, Height: 50, Bytes: 100, Kind: "region", Region } }] } };
	const Combined = combine_pdf_image(Selection, Image); assert.equal(Combined.SelectedText, Selection.SelectedText); assert.deepEqual(Combined.PdfTarget, Selection.PdfTarget); assert.equal(Combined.CapturedAt, Selection.CapturedAt); assert.equal(Combined.Pdf!.Pages[0].Region!.Rotation, 90);
	const Page: ContextSnapshot = { ...Snapshot, Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [{ Number: 3, TextLayer: true, Image: { Id: "c".repeat(64), Width: 100, Height: 100, Bytes: 100 } }] } };
	const Two = combine_pdf_image(Combined, Page); assert.equal(Two.Pdf!.Pages.length, 2); assert.throws(() => combine_pdf_image(Two, Image), /最多两张/); assert.equal(Two.Pdf!.Pages.length, 2);
	for(const Wrong of [{ ...Image, Path: "other.pdf" }, { ...Image, Version: "new" }, { ...Image, Version: undefined }, { ...Page, Pdf: { ...Page.Pdf!, Pages: [{ ...Page.Pdf!.Pages[0], Number: 4 }] } }]) { assert.throws(() => combine_pdf_image(Selection, Wrong), /原选择保留/); }
	assert.equal(Selection.Pdf, undefined);
});

test("connection picker preserves options and the active selection when activation fails", async () =>
{
	const { V, Notices } = fixture(); let Active = "local", Builds = 0;
	V.ConnectionRow = { hidden: false }; V.ConnectionSelect = { dataset: {}, value: "", empty: () => { Builds++; }, createEl() {} }; V.ConnectionLabel = { setText() {} };
	V.Owner.connection_choices = () => [{ Id: "local", Label: "Local", Active: Active === "local" }, { Id: "api", Label: "API", Active: Active === "api" }]; V.Owner.connection_label = () => "actual connection";
	V.refresh_connections(); V.refresh_connections(); assert.equal(Builds, 1); assert.equal(V.ConnectionSelect.value, "local");
	V.Owner.choose_connection = async () => { throw Error("fixture activation failed"); }; V.ConnectionSelect.value = "api";
	await V.choose_connection("api"); assert.equal(V.ConnectionSelect.value, "local"); assert.equal(V.ConnectionSelect.disabled, false); assert.match(Notices[0], /activation failed/); assert.equal(Builds, 1);
	V.Owner.choose_connection = async () => { Active = "api"; }; await V.choose_connection("api"); assert.equal(V.ConnectionSelect.value, "api"); assert.equal(Builds, 1);
	V.Owner.connection_choices = undefined; V.refresh_connections(); assert.equal(V.ConnectionRow.hidden, true);
});

test("quote navigation checks scope again after history hydration and after rendering", async () =>
{
	const { V } = fixture(); let Resume!: () => void, Focused = 0;
	V.Opened = true; V.Owner.ensure_session_history = () => new Promise<void>(R => Resume = R); V.HistoryWindow = { focus: () => { Focused++; return true; }, snapshot: () => undefined, restore() {} };
	const Loading = V.reveal_message("answer", Quote); V.Owner.draft_scope = () => "new-scope"; Resume(); await Loading; assert.equal(Focused, 0);
	V.Owner.draft_scope = () => "scope"; V.Owner.ensure_session_history = async () => {}; V.render_messages = async () => { V.Owner.draft_scope = () => "switched-during-render"; };
	let Lookups = 0; V.MessagesElement = { querySelectorAll: () => { Lookups++; return []; } }; await V.reveal_message("answer", Quote); assert.equal(Focused, 1); assert.equal(Lookups, 0);
});

test("branch quote navigation locates only the version-verified copied ancestor block and otherwise falls back to the copied message", async () =>
{
	const { V, Notices } = fixture(), Text = "original inherited proof", Block = markdown_blocks(Text)[0];
	const Q = answer_quote("original", "answer", "proof", Text, "completed", { Mapping: "source-blocks", Range: { From: Block.From, To: Block.To }, BlockIds: [Block.Id] });
	V.Opened = true; V.Owner.Session = { Id: "branch", ParentId: "original", Messages: [{ Id: "answer", Role: "assistant", Text }] }; V.Owner.State.Sessions = [{ Id: "original", Messages: [] }, V.Owner.Session];
	let BlocksScrolled = 0, CardsScrolled = 0;
	const Node = { dataset: { codexAnswerBlock: Block.Id, codexAnswerFrom: String(Block.From), codexAnswerTo: String(Block.To) }, scrollIntoView: () => BlocksScrolled++, animate() {} };
	const Body = { dataset: { codexAnswerVersion: text_identity(Text), codexAnswerMessage: JSON.stringify(["desktop", "branch"]) + ":answer" }, querySelectorAll: () => [Node] };
	const Card = { dataset: { messageId: "answer" }, querySelector: () => Body, scrollIntoView: () => CardsScrolled++ };
	V.MessagesElement = { clientHeight: 400, querySelectorAll: (Selector: string) => Selector === "[data-message-id]" ? [Card] : [] }; V.Owner.ensure_session_history = async () => {}; V.HistoryWindow = { focus: () => true, snapshot: () => undefined, restore() {} }; V.render_messages = async () => {};
	V.MessageList = { reveal: (_Id: string, Resolve: (Element: typeof Card) => any) => { const Element = Resolve(Card); if(!Element) { return false; } Element.scrollIntoView(); return true; }, reanchor() {} };
	await V.reveal_message("answer", Q); assert.equal(BlocksScrolled, 1); assert.equal(CardsScrolled, 0);
	V.Owner.Session.Messages[0].Text += " changed"; await V.reveal_message("answer", Q); assert.equal(BlocksScrolled, 1); assert.equal(CardsScrolled, 1); assert.match(Notices.at(-1)!, /已返回原消息/);
	await V.reveal_message("answer", { ...Q, SessionId: "unrelated" }); assert.equal(CardsScrolled, 1); assert.match(Notices.at(-1)!, /未跳到当前会话/);
});

test("an invalid cross-session quote blocks sending and preserves input instead of silently substituting automatic context",async()=>
{
	const {V}=fixture();let Sends=0;V.Owner.send_chat=async()=>{Sends++;return true;};V.Owner.AnswerQuote.SessionId="foreign";V.Input.value="keep original input";
	assert.equal(V.current_material().Context,null);await V.send_input("question");assert.equal(Sends,0);assert.equal(V.Input.value,"keep original input");assert.equal(V.Owner.AnswerQuote.SessionId,"foreign");assert.match(V.DraftError,/引用不属于/);
});
