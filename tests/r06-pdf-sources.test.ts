import { test } from "node:test";
import assert from "node:assert/strict";
import { combine_pdf_image, resolve_material } from "../src/composer-material";
import { ComposerDraftStore } from "../src/composer-draft";
import { answer_sources, locate_source, open_source, rename_sources, render_sources, source_label, source_reference, validate_source_reference, type SourceReference } from "../src/sources";
import { pdf_hash } from "../src/pdf/types";
import { message_pdf_refs } from "../src/pdf/inputs";
import { pdf_target } from "../src/pdf/target";
import { branch_prefix } from "../src/history";
import type { ContextSnapshot } from "../src/prompt";

async function fixture()
{
	const Bytes = new TextEncoder().encode("original synthetic PDF version").buffer;
	const Selection: ContextSnapshot = { Path: "Original/condition.pdf", Mode: "阅读", Kind: "选区", Mapping: "PDF文本层", CapturedAt: "original-text-time", Text: "设 a > 0", SelectedText: "a > 0", Heading: "PDF 第 3 页文字选区", LineStart: null, LineEnd: null, Truncated: false, Version: await pdf_hash(Bytes), PdfTarget: pdf_target(3, "text", "0,2,0,7") };
	const Image: ContextSnapshot = { ...Selection, Mapping: "PDF页图", CapturedAt: "supplement-time", SelectedText: "", PdfTarget: undefined, Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [{ Number: 3, TextLayer: false, Image: { Id: "a".repeat(64), Width: 1000, Height: 1000, Bytes: 100 } }] } };
	const Region = { X: 0.1, Y: 0.2, Width: 0.4, Height: 0.3, PageWidth: 1000, PageHeight: 1000, Scale: 1, Rotation: 90 };
	const Crop: ContextSnapshot = { ...Image, Pdf: { schemaVersion: 2, ReadOnly: true, PageCount: 4, Pages: [{ Number: 3, TextLayer: false, Kind: "region", Region, Image: { Id: "b".repeat(64), Width: 400, Height: 300, Bytes: 100, Kind: "region", Region } }] } };
	const Opened: string[] = [], OpenedFiles: string[] = [];
	let Path = Selection.Path, Current = Bytes;
	const App: any = { vault: { getFileByPath: (Value: string) => Value === Path ? { path: Path, stat: { size: Current.byteLength } } : null, readBinary: async () => Current }, workspace: { openLinkText: async (Link: string) => { Opened.push(Link); }, getLeavesOfType: () => [], getLeaf: () => ({ openFile: async (File: any) => { OpenedFiles.push(File.path); } }) } };
	return { Selection, Image, Crop, Bytes, App, Opened, OpenedFiles, move: (Value: string) => { Path = Value; }, change: () => { Current = new TextEncoder().encode("changed synthetic PDF version").buffer; } };
}

function answer(Context: ContextSnapshot, Sources = source_reference(Context))
{
	const User = { Id: "question", Role: "user", TurnId: "original-turn", Context, Sources }, Answer = { Id: "answer", Role: "assistant", TurnId: "original-turn" };
	const Saved = JSON.parse(JSON.stringify([User, Answer]));
	return { Saved, Sources: answer_sources(Saved, Saved[1]) };
}

test("R06: text selection supplemented by an image still navigates to the original native text anchor", async () =>
{
	const { Selection, Image, App, Opened } = await fixture();
	const Combined = combine_pdf_image(Selection, Image);
	const { Sources } = answer(Combined);
	assert.equal(Sources.length, 2, "the original text and the supplementary page image must be independent sources");
	const Text = Sources.find(Ref => Ref.Anchor?.includes("selection="));
	assert.ok(Text, "the original native text anchor must remain available in the answer source index");
	await open_source(App, Text);
	assert.deepEqual(Opened, [Selection.Path + "#page=3&selection=0,2,0,7"]);
});

test("R06: text plus crop plus page remains three independent sources and exactly two images", async () =>
{
	const { Selection, Image, Crop } = await fixture(), Before = JSON.stringify([Selection, Image, Crop]);
	const Combined = combine_pdf_image(combine_pdf_image(Selection, Crop), Image), Refs = source_reference(Combined);
	assert.equal(Refs.length, 3); assert.equal(new Set(Refs.map(Ref => Ref.Id)).size, 3);
	assert.equal(Refs[0].Id, source_reference(Selection)[0].Id, "adding visual references must not replace the original text identity");
	Refs.forEach(Ref => validate_source_reference(Ref));
	assert.deepEqual(Refs.map(Ref => Ref.ImageKind), [undefined, "region", "page"]);
	assert.deepEqual(Refs[1].Region, Crop.Pdf!.Pages[0].Region); assert.equal(Refs[1].Region!.Rotation, 90);
	assert.equal(Refs[1].Anchor, undefined); assert.equal(Refs[2].Anchor, undefined);
	assert.equal(Refs[1].Purpose, "capture"); assert.equal(Refs[1].Mapping, "PDF页图");
	assert.match(source_label(Refs[0], Refs), /原文字选区/);
	assert.match(source_label(Refs[1], Refs), /局部图.*补充图像.*旋转 90°/);
	assert.match(source_label(Refs[2], Refs), /整页图.*补充图像/);
	assert.doesNotMatch(source_label(Refs[1], Refs), /原选区|原文字选区|原图像选区/);
	const Material = resolve_material({ Scope: "scope", SessionId: "session", AttachContext: true, Automatic: null, Attachment: { Scope: "scope", SessionId: "session", Snapshot: Combined }, Quote: null });
	assert.equal(Material.ImageCount, 2); assert.deepEqual(Material.Issues, []);
	assert.equal(message_pdf_refs({ Id: "u", Role: "user", Text: "解释", Context: Combined }).length, 2);
	assert.throws(() => combine_pdf_image(Combined, Crop), /最多两张/);
	for(const Wrong of [{ ...Crop, Path: "Other/condition.pdf" }, { ...Crop, Version: "other-version" }, { ...Crop, Version: undefined }, { ...Crop, Pdf: { ...Crop.Pdf!, Pages: [{ ...Crop.Pdf!.Pages[0], Number: 2 }] } }])
	{
		assert.throws(() => combine_pdf_image(Selection, Wrong), /原选择保留/);
	}
	assert.equal(JSON.stringify([Selection, Image, Crop]), Before);
});

test("R06: draft restoration, independent image removal and restart keep the exact original text identity", async () =>
{
	const { Selection, Image, Crop, App, Opened } = await fixture(), Data = new Map<string, string>();
	const Storage = { getItem: (Key: string) => Data.get(Key) ?? null, setItem: (Key: string, Value: string) => { Data.set(Key, Value); } };
	const Store = new ComposerDraftStore(Storage, "device:scope", "session");
	Store.save("解释补充条件", { Context: combine_pdf_image(combine_pdf_image(Selection, Crop), Image), ContextOrigin: "explicit", Quote: null }, 0);
	const Restored = new ComposerDraftStore(Storage, Store.Scope, Store.SessionId).load()!;
	assert.deepEqual(Restored.Context!.PdfTarget, Selection.PdfTarget);
	const Context = Restored.Context!;
	const One = { ...Context, Pdf: { ...Context.Pdf!, Pages: Context.Pdf!.Pages.filter(Page => Page.Kind !== "region") } };
	const { Pdf: _Pdf, ...None } = One;
	for(const Value of [Context, One, None])
	{
		const { Sources } = answer(Value); assert.equal(Sources[0].Id, source_reference(Selection)[0].Id);
		await open_source(App, Sources[0]);
	}
	assert.equal(source_reference(One).length, 2); assert.equal(source_reference(None).length, 1);
	assert.deepEqual(Opened, Array(3).fill(Selection.Path + "#page=3&selection=0,2,0,7"));
});

test("R06: legacy image-only source indexes derive saved text anchors without rewriting identities or move observations", async () =>
{
	const F = await fixture(), Context = combine_pdf_image(F.Selection, F.Crop);
	const Legacy: SourceReference = { ...source_reference(Context)[1], Id: "original-saved-image-id", Purpose: "selection", Mapping: "PDF文本层", Anchor: Context.Text, CurrentPath: "Moved/condition.pdf" };
	const { Saved } = answer(Context, [Legacy]), Before = JSON.stringify(Saved);
	const Refs = answer_sources(Saved, Saved[1]);
	assert.equal(Refs.length, 2); assert.equal(Refs[1].Id, Legacy.Id);
	assert.deepEqual(Refs[1], Legacy); assert.equal(Refs[0].CurrentPath, Legacy.CurrentPath);
	assert.equal(Refs[0].Anchor, "pdf-target-v1:page=3&selection=0,2,0,7");
	assert.match(source_label(Refs[1], Refs), /补充图像/);
	F.move(Legacy.CurrentPath!); await open_source(F.App, Refs[0]);
	assert.equal(F.Opened[0], "Moved/condition.pdf#page=3&selection=0,2,0,7");
	assert.equal(JSON.stringify(Saved), Before, "derived navigation must never migrate or rewrite the historical message");
});

test("R06: saved missing or malformed text anchors stay unknown rather than being guessed from image text", async () =>
{
	const { Selection, Image } = await fixture(), Combined = combine_pdf_image(Selection, Image);
	for(const Value of [undefined, { Kind: "text", Page: 3, Values: [0, 7, 0, 2] }, { Kind: "text", Page: 3, Selection: [0, 2, 0, 7] }, pdf_target(5, "text", "0,2,0,7")])
	{
		const Context = { ...Combined, PdfTarget: Value } as ContextSnapshot;
		const Refs = answer(Context).Sources;
		assert.equal(Refs.length, 1); assert.equal(Refs[0].ImageKind, "page"); assert.equal(Refs[0].Anchor, undefined);
		assert.doesNotMatch(source_label(Refs[0], Refs), /原文字选区|补充图像/);
	}
});

test("R06: text and image navigation independently follow observed renames and reject stale versions and same-name guesses", async () =>
{
	const F = await fixture(), Refs = source_reference(combine_pdf_image(F.Selection, F.Crop));
	const Moved = rename_sources(Refs, "Original", "Moved"); F.move("Moved/condition.pdf");
	for(const Ref of Refs) { await assert.rejects(open_source(F.App, Ref), /不存在/); }
	await open_source(F.App, Moved[0]); await open_source(F.App, Moved[1]);
	assert.deepEqual(F.Opened, ["Moved/condition.pdf#page=3&selection=0,2,0,7", "Moved/condition.pdf#page=3"]);
	assert.equal(Moved[0].Path, F.Selection.Path); assert.equal(Moved[1].Region!.Rotation, 90);
	F.change();
	for(const Ref of Moved)
	{
		const Changed = await open_source(F.App, Ref);
		assert.equal(Changed.Status, "changed"); assert.equal(Changed.Page, undefined); assert.equal(Changed.Subpath, undefined);
	}
	assert.deepEqual(F.OpenedFiles, ["Moved/condition.pdf", "Moved/condition.pdf"]);
	assert.equal(F.Opened.length, 2, "changed PDFs must not reuse a formerly exact text/page location");
	await assert.rejects(open_source(F.App, { ...Moved[0], PathExact: false }), /同名/);
	assert.equal((await locate_source(F.App, { ...Moved[0], Version: undefined })).Status, "unknown");
});

test("R06: follow-up quote and branch restart retain text and image sources without retargeting or re-identifying", async () =>
{
	const F = await fixture(), Context = combine_pdf_image(F.Selection, F.Crop), { Saved, Sources } = answer(Context);
	const Quote = { SessionId: "session", MessageId: "answer", SelectedText: "解释中的条件", SourceText: "原说明", SelectedTruncated: false, SourceTruncated: false, SourcePath: F.Selection.Path, SourceReferences: Sources };
	const Followup: any = { Id: "follow-up", Role: "user", TurnId: "follow-up-turn", Text: "继续解释", Quote };
	const Branch = branch_prefix([...Saved, Followup, { Id: "next", Role: "user", Text: "next" }], "next");
	const Reply = { Id: "new-answer", Role: "assistant", TurnId: "follow-up-turn" };
	const Refs = answer_sources(JSON.parse(JSON.stringify(Branch)), Reply);
	assert.deepEqual(Refs, Sources); await open_source(F.App, Refs[0]); await open_source(F.App, Refs[1]);
	assert.deepEqual(F.Opened, [F.Selection.Path + "#page=3&selection=0,2,0,7", F.Selection.Path + "#page=3"]);
	Branch.at(-1)!.Quote!.SourceReferences![0].Anchor = "changed branch copy";
	assert.equal(Quote.SourceReferences[0].Anchor, "pdf-target-v1:page=3&selection=0,2,0,7");
});

test("R06: actual source button handlers dispatch text selection and image page links separately", async () =>
{
	const F = await fixture(), Refs = answer(combine_pdf_image(F.Selection, F.Crop)).Sources;
	const Buttons: { Text: string; disabled: boolean; Click: () => void }[] = [], Status: string[] = [];
	const Root: any = { createDiv: () => Root, setText: (Text: string) => Status.push(Text), createEl: (Tag: string, Options: any) =>
	{
		if(Tag !== "button") { return Root; }
		const Button = { Text: Options.text, disabled: false, Click: () => {}, addEventListener: (_Name: string, Click: () => void) => { Button.Click = Click; } };
		Buttons.push(Button); return Button;
	} };
	render_sources(F.App, Root, Refs);
	assert.equal(Buttons.length, 2); assert.match(Buttons[0].Text, /原文字选区/); assert.match(Buttons[1].Text, /补充图像/);
	for(const [Index, Button] of Buttons.entries())
	{
		Button.Click(); assert.equal(Button.disabled, true);
		for(let I = 0; I < 100 && Button.disabled; I++) { await new Promise(Resolve => setTimeout(Resolve, 1)); }
		assert.equal(Button.disabled, false); assert.equal(F.Opened.length, Index + 1);
	}
	assert.deepEqual(F.Opened, [F.Selection.Path + "#page=3&selection=0,2,0,7", F.Selection.Path + "#page=3"]);
	assert.match(Status[0], /原文字选区/); assert.match(Status[1], /原实际页码/);
});

test("R06: ambiguous old move observations never assign a new text anchor to an arbitrary destination", async () =>
{
	const F = await fixture(), Context = combine_pdf_image(F.Selection, F.Crop), Image = source_reference(Context)[1];
	const Sources = [{ ...Image, Id: "move-a", CurrentPath: "A/condition.pdf" }, { ...Image, Id: "move-b", CurrentPath: "B/condition.pdf" }];
	const Refs = answer(Context, Sources).Sources;
	assert.equal(Refs[0].CurrentPath, undefined); assert.equal(Refs[0].Path, F.Selection.Path);
	assert.equal(Refs.length, 3); assert.deepEqual(Refs.slice(1).map(Ref => Ref.Id), ["move-a", "move-b"]);
});
