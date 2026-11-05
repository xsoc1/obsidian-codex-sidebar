import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { jpeg_info, pdf_hash, pdf_reference, reference_id, validate_pdf, validate_region } from "../src/pdf/types";
import { BridgePdfImages } from "../src/pdf/bridge-cache";
import { image_inputs, message_pdf_refs, history_pdf_refs } from "../src/pdf/inputs";
import { branch_prefix, history_items } from "../src/history";
import { build_prompt, type ContextSnapshot } from "../src/prompt";
import { note_path, source_path } from "../src/edit/document";
import { parse_pdf_link, pdf_target, pdf_selected_text, pdf_target_subpath, resolve_pdf_file } from "../src/pdf/target";
import { live_pdf_target, pdf_plus_active } from "../src/pdf/plus";
import { locate_source, source_reference, validate_source_reference } from "../src/sources";
import { pdf_box_target } from "../src/pdf/box";

const Data = "data:image/jpeg;base64," + readFileSync("examples/pdf/scanned-page.jpg").toString("base64");
const Id = createHash("sha256").update(Data).digest("hex");
const Ref = { Id, ...jpeg_info(Data) };
const Snapshot: ContextSnapshot = { Path: "original.pdf", Text: "扫描页, 文字层不可用", SelectedText: "", Heading: "第 1 页", Mode: "阅读", Kind: "当前位置", Mapping: "PDF页图", CapturedAt: "original-time", LineStart: null, LineEnd: null, Truncated: false, Version: "a".repeat(64), Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 2, Pages: [{ Number: 1, TextLayer: false, Image: Ref }] } };

test("PDF references validate original JPEG bounds and metadata without permitting inline data, arbitrary paths or URLs", () =>
{
	assert.equal(Ref.Width, 1224); assert.equal(Ref.Height, 1584);
	validate_pdf(Snapshot.Pdf!);
	assert.equal(reference_id(pdf_reference(Id)), Id);
	for(const Url of ["https://external/image.jpg", "file:///secret", "data:image/jpeg;base64,abc", "../private", "obsidian-pdf:" + "A".repeat(64)]) { assert.throws(() => reference_id(Url)); }
	for(const Value of [Data.replace("jpeg", "png"), Data.slice(0, -4), "data:image/jpeg;base64," + "a".repeat(1500001)]) { assert.throws(() => jpeg_info(Value)); }
	for(const Change of [ { ReadOnly: false }, { Pages: [] }, { PageCount: 0 }, { javascript: "run" }, { Pages: [{ Number: 1, TextLayer: false, Image: { ...Ref, data: Data } }] }, { Pages: [{ Number: 3, TextLayer: false, Image: Ref }] }, { Pages: [Snapshot.Pdf!.Pages[0], Snapshot.Pdf!.Pages[0]] } ]) { assert.throws(() => validate_pdf({ ...Snapshot.Pdf!, ...Change } as any)); }
	assert.throws(() => validate_pdf({ ...Snapshot.Pdf!, Pages: [{ ...Snapshot.Pdf!.Pages[0], Image: { ...Ref, Kind: "region" } }] }), /未知字段/);
	assert.equal(source_path("course/original.PDF"), "course/original.PDF");
	assert.throws(() => source_path("../private.pdf")); assert.throws(() => note_path("course/original.pdf"));
});

test("owned bridge page caches persist by device, deduplicate uploads, refuse late epochs and never replace missing originals", () =>
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-pdf-cache-"));
	try
	{
		const A = new BridgePdfImages(join(Directory, "a")), B = new BridgePdfImages(join(Directory, "b"));
		const Epoch = A.request({ action: "has", ids: [Id] }).epoch;
		assert.deepEqual(A.request({ action: "put", id: Id, data: Data, epoch: Epoch }), Ref);
		assert.deepEqual(A.request({ action: "put", id: Id, data: Data, epoch: Epoch }), Ref);
		assert.equal(new BridgePdfImages(join(Directory, "a")).resolve(pdf_reference(Id)), Data);
		assert.throws(() => B.resolve(pdf_reference(Id)), /缺失/);
		assert.throws(() => A.request({ action: "put", id: "b".repeat(64), data: Data, epoch: Epoch }), /哈希/);
		assert.throws(() => A.request({ action: "clear", path: "../a" }), /未知/);
		A.request({ action: "clear" });
		assert.throws(() => A.request({ action: "put", id: Id, data: Data, epoch: Epoch }), /迟到/);
		assert.throws(() => A.resolve(pdf_reference(Id)), /缺失/);
		const Current = A.request({ action: "has", ids: [] }).epoch;
		A.request({ action: "put", id: Id, data: Data, epoch: Current });
		writeFileSync(join(Directory, "a", Id + ".jpeg-data"), Data.replace("base64,", "base64,A"));
		assert.throws(() => A.get(Id));
	}
	finally { rmSync(Directory, { recursive: true, force: true }); }
});

test("PDF prompts and replay retain capture time, truncation, page identity and original image without storing base64 in chat", () =>
{
	const Original = structuredClone(Snapshot); Original.Truncated = true;
	const Message: any = { Id: "q", Role: "user", Text: "解释", Prompt: build_prompt("解释", Original), Context: Original };
	const Urls = new Map([[Id, pdf_reference(Id)]]);
	assert.match(Message.Prompt, /只读/); assert.match(Message.Prompt, /已截断/); assert.match(Message.Prompt, /original-time/);
	assert.equal(JSON.stringify(Message).includes("base64"), false);
	assert.deepEqual(image_inputs(message_pdf_refs(Message), Urls), [{ type: "image", url: pdf_reference(Id) }]);
	assert.throws(() => image_inputs(message_pdf_refs(Message), new Map()));
	assert.throws(() => history_items([Message]));
	assert.deepEqual(history_items([Message, { ...Message, Id: "q2" }], Urls).map(Item => Item.content.filter(Part => Part.type === "input_image").length), [1, 0]);
	const Copy = branch_prefix([Message, { ...Message, Id: "next" }], "next")[0];
	assert.equal(Copy.Context!.Pdf!.Pages[0].Image.Id, Id);
	Original.Pdf!.Pages[0].Number = 2;
	assert.equal(Copy.Context!.Pdf!.Pages[0].Number, 1);
	assert.equal(history_pdf_refs([Message]).length, 1);
});

function reader_fixture(Scanned = false)
{
	const Bundle = buildSync({ entryPoints: ["src/pdf/reader.ts"], bundle: true, write: false, platform: "browser", format: "cjs", external: ["obsidian"] }).outputFiles[0].text;
	const Export = { exports: {} as any };
	runInNewContext(Bundle, { module: Export, exports: Export.exports, crypto: webcrypto, TextEncoder, Uint8Array, atob, structuredClone, setTimeout, clearTimeout, require: () => ({ loadPdfJs: () => { throw new Error("supply fixture loader"); } }) });
	const File: any = { path: "original.pdf", extension: "pdf", stat: { mtime: 1, size: 100 } };
	let Loads = 0, Renders = 0; const RenderOptions: any[] = [];
	const Images: any = { put: async (_Data: any, Origin: any) => ({ ...Ref, Width: Canvas.width, Height: Canvas.height, ...(Origin ?? {}) }) };
	const Reader = new Export.exports.PdfReader({ vault: { readBinary: async () => new ArrayBuffer(100) } }, Images, async () => ({ getDocument: (Params: any) =>
	{
		assert.equal(Params.isEvalSupported, false); assert.equal(Params.cMapPacked, true); assert.equal(Params.cMapUrl, "/lib/pdfjs/cmaps/"); Loads++;
		return { promise: Promise.resolve({ numPages: 3, destroy: async () => {}, getPage: async () => ({ getTextContent: async () => ({ items: Scanned ? [] : [{ str: "[X,Y]=2Y", hasEOL: true }] }), getViewport: ({ scale, rotation = 0 }: any) => rotation === 90 ?
			{ width: 792 * scale, height: 612 * scale, rotation, convertToViewportRectangle: ([A,B,C,D]: number[]) => [B * scale, A * scale, D * scale, C * scale] } :
			{ width: 612 * scale, height: 792 * scale, rotation, convertToViewportRectangle: ([A,B,C,D]: number[]) => [A * scale, (792 - B) * scale, C * scale, (792 - D) * scale] }, render: (Options: any) => { assert.equal(Options.intent, "print"); Renders++; RenderOptions.push(Options); return { promise: Promise.resolve(), cancel: () => {} }; } }) }) };
	} }));
	const Canvas: any = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => Data };
	return { Reader, File, Owner: { createElement: () => Canvas }, Canvas, RenderOptions, counts: () => ({ Loads, Renders }), location: Export.exports.pdf_location };
}

test("direct PDF drag uses the displayed canvas, reverse direction and viewer rotation without a PDF++ dependency", () =>
{
	const Bounds = { left: 100, top: 200, width: 400, height: 600 };
	const Start = { x: 180, y: 320 }, End = { x: 380, y: 620 };
	const View = { width: 200, height: 300, rotation: 90, convertToPdfPoint: (X: number, Y: number) => [Y + 10, X + 20] };
	const Expected = { Target: pdf_target(4, "rect", "70,60,220,160"), Rotation: 90 };
	assert.deepEqual(pdf_box_target(4, Bounds, Start, End, View), Expected);
	assert.deepEqual(pdf_box_target(4, Bounds, End, Start, View), Expected);
	assert.throws(() => pdf_box_target(4, Bounds, Start, { x: 510, y: 310 }, View), /同一张/);
	assert.throws(() => pdf_box_target(4, Bounds, Start, { x: 182, y: 310 }, View), /太小/);
	assert.throws(() => pdf_box_target(4, Bounds, Start, End, { ...View, rotation: 45 }), /旋转角度/);
});

test("direct PDF crop preserves display rotation in the actual render, versioned context and source", async () =>
{
	const F = reader_fixture(true);
	try
	{
		const Target = pdf_target(2, "rect", "100,180,300,320");
		const Snapshot = await F.Reader.capture_target(F.File, Target, F.Owner, undefined, undefined, 90);
		const Region = Snapshot.Pdf.Pages[0].Region;
		assert.equal(Region.Rotation, 90); assert.equal(Region.PageWidth, 792); assert.equal(Region.PageHeight, 612);
		assert.equal(Region.X, 180 / 792); assert.equal(Region.Y, 100 / 612);
		assert.equal(F.RenderOptions[0].viewport.rotation, 90);
		assert.equal(source_reference(Snapshot)[0].Anchor, "pdf-target-v1:page=2&rect=100,180,300,320");
		assert.equal(message_pdf_refs({ Context: Snapshot } as any).length, 1);
		await assert.rejects(F.Reader.capture_target(F.File, Target, F.Owner, undefined, undefined, 45), /角度/);
		const Abort = new AbortController(); Abort.abort();
		await assert.rejects(F.Reader.capture_target(F.File, Target, F.Owner, Abort.signal), /取消/);
		assert.equal(F.counts().Renders, 1);
	}
	finally { F.Reader.close(); }
});

test("PDF++ imports vault-local selection links and refuses ambiguous files or unbounded targets", () =>
{
	const Text = parse_pdf_link("[[课本/李代数.pdf#page=2&selection=0,0,0,5|定理]]");
	assert.equal(Text.Path, "课本/李代数.pdf");
	assert.equal(pdf_target_subpath(Text.Target), "#page=2&selection=0,0,0,5");
	assert.deepEqual(parse_pdf_link("![公式](<Course/Formula%20Book.pdf#page=3&rect=12,18,100,200&width=300>)"), { Path: "Course/Formula Book.pdf", Target: pdf_target(3, "rect", "12,18,100,200") });
	for(const Link of ["[[A.pdf#page=1]]", "https://a.test/a.pdf#page=1&rect=1,2,3,4", "[[../a.pdf#page=1&rect=1,2,3,4]]", "[[a.pdf#page=1&selection=0,0,0,0]]", "[[a.pdf#page=1&rect=1,4,3,2]]", "[[a.pdf#page=1&page=2&rect=1,2,3,4]]", "[[a.pdf#page=1&rect=1,2,3,4&selection=0,0,0,1]]"]) { assert.throws(() => parse_pdf_link(Link)); }
	const Files = ["A/a.pdf", "B/a.pdf", "A/b.pdf"].map(path => ({ path, extension: "pdf" }));
	const App: any = { vault: { getFiles: () => Files } };
	assert.throws(() => resolve_pdf_file(App, "a.pdf"), /多个同名/);
	assert.equal(resolve_pdf_file(App, "A/a.pdf"), Files[0]);
	assert.equal(resolve_pdf_file(App, "b.pdf"), Files[2]);
	assert.throws(() => resolve_pdf_file(App, "c.pdf"), /找不到/);
});

test("PDF++ live viewer lookup is optional and never infers offsets for an unsupported viewer", () =>
{
	const PageEl = {}, Root: any = { querySelector: () => PageEl };
	const Absent: any = {}, Unknown: any = { plugins: { getPlugin: () => ({}) } };
	const Supported: any = { plugins: { getPlugin: (Id: string) => Id === "pdf-plus" ? { lib: { getPDFViewerChildAssociatedWithNode: (NodeValue: unknown) =>
	{
		assert.equal(NodeValue, PageEl);
		return { getTextSelectionRangeStr: () => "0,1,0,5" };
	} } } : null } };
	assert.equal(pdf_plus_active(Absent), false); assert.equal(live_pdf_target(Absent, Root, 1), null);
	assert.equal(pdf_plus_active(Unknown), true); assert.equal(live_pdf_target(Unknown, Root, 1), null);
	assert.deepEqual(live_pdf_target(Supported, Root, 2), pdf_target(2, "text", "0,1,0,5"));
	const Multi = pdf_target(2, "text", "0,1,2,2") as Extract<ReturnType<typeof pdf_target>, { Kind: "text" }>;
	assert.equal(pdf_selected_text(Multi, [{ str: "abc", hasEOL: true }, { str: "def" }, { str: "ghi" }]), "bc\ndef gh");
});

test("PDF++ text works without images, scans crop only the requested area and versioned sources downgrade safely", async () =>
{
	const TextFixture = reader_fixture(), ScanFixture = reader_fixture(true);
	try
	{
		const TextTarget = pdf_target(1, "text", "0,0,0,5"), RectTarget = pdf_target(2, "rect", "100,180,300,320");
		const Text = await TextFixture.Reader.capture_target(TextFixture.File, TextTarget, TextFixture.Owner);
		const Rect = await ScanFixture.Reader.capture_target(ScanFixture.File, RectTarget, ScanFixture.Owner);
		assert.equal(Text.SelectedText, "[X,Y]"); assert.equal(Text.Pdf, undefined); assert.equal(TextFixture.counts().Renders, 0);
		assert.match(build_prompt("解释", Text), /\[X,Y\]/);
		const Msg: any = { Id: "q", Role: "user", Text: "解释", Context: Text, Prompt: build_prompt("解释", Text) };
		assert.equal(message_pdf_refs(Msg).length, 0);
		assert.equal(JSON.stringify(branch_prefix([Msg, { Id: "next", Role: "user" } as any], "next")[0].Context?.PdfTarget), JSON.stringify(TextTarget));
		assert.equal(Rect.Pdf.Pages[0].Number, 2); assert.equal(Rect.Pdf.Pages[0].Kind, "region"); assert.equal(Rect.Pdf.Pages[0].TextLayer, false);
		assert.equal(Rect.Pdf.Pages[0].Region.X, 100 / 612); assert.equal(Rect.Pdf.Pages[0].Region.Y, (792 - 320) / 792);
		assert.equal(message_pdf_refs({ ...Msg, Context: Rect }).length, 1);
		const [TextRef] = source_reference(Text), [RectRef] = source_reference(Rect);
		assert.equal(validate_source_reference(TextRef).Kind, "pdf");
		let Enabled = true, Changed = false;
		const App: any = { plugins: { getPlugin: () => Enabled ? {} : null }, vault: { getFileByPath: () => TextFixture.File, readBinary: async () => new ArrayBuffer(Changed ? 101 : 100) } };
		assert.equal((await locate_source(App, TextRef)).Subpath, "#page=1&selection=0,0,0,5");
		assert.equal((await locate_source(App, RectRef)).Subpath, "#page=2&rect=100,180,300,320");
		Enabled = false;
		assert.equal((await locate_source(App, RectRef)).Subpath, undefined);
		assert.equal((await locate_source(App, RectRef)).Page, 2);
		assert.equal((await locate_source(App, TextRef)).Subpath, "#page=1&selection=0,0,0,5");
		Changed = true;
		assert.equal((await locate_source(App, TextRef)).Status, "changed");
		assert.equal((await locate_source(App, RectRef)).Page, undefined);
		await assert.rejects(TextFixture.Reader.capture_target(TextFixture.File, pdf_target(1, "text", "0,0,0,50"), TextFixture.Owner), /偏移/);
		await assert.rejects(ScanFixture.Reader.capture_target(ScanFixture.File, pdf_target(1, "rect", "100,180,650,320"), ScanFixture.Owner), /超出页面/);
	}
	finally { TextFixture.Reader.close(); ScanFixture.Reader.close(); }
});

test("bounded PDF reader preserves text-layer and scan metadata, rejects stale files, invalid pages and oversized documents", async () =>
{
	for(const Scanned of [false, true])
	{
		const Fixture = reader_fixture(Scanned);
		const Value = await Fixture.Reader.capture(Fixture.File, [1, 2], Fixture.Owner, "选区", "s".repeat(12001), true);
		assert.equal(Value.Mapping, Scanned ? "PDF页图" : "PDF文本层"); assert.equal(Value.Pdf.Pages.length, 2);
		assert.equal(Value.Truncated, true); assert.equal(Value.SelectedText.length, 12000); assert.equal(Fixture.Canvas.width, 0);
		await Fixture.Reader.page_count(Fixture.File); assert.equal(Fixture.counts().Loads, 1);
		await assert.rejects(Fixture.Reader.capture(Fixture.File, [4], Fixture.Owner), /页码/);
		Fixture.File.stat.size = 81 * 1024 * 1024;
		await assert.rejects(Fixture.Reader.page_count(Fixture.File), /80 MB/);
		Fixture.Reader.close(); await assert.rejects(Fixture.Reader.page_count(Fixture.File), /关闭/);
	}
	const Fixture = reader_fixture();
	const Original = Fixture.Owner.createElement;
	Fixture.Owner.createElement = () => { Fixture.File.stat.mtime++; return Original(); };
	await assert.rejects(Fixture.Reader.capture(Fixture.File, [1], Fixture.Owner), /变化/);
	Fixture.Reader.close();
});

test("PDF viewport selection is bounded to two intersecting pages and unmapped views never silently use page one", () =>
{
	const { location } = reader_fixture();
	const Pages = [1, 2, 3].map(NumberValue => ({ dataset: { pageNumber: String(NumberValue) }, getBoundingClientRect: () => ({ top: NumberValue === 2 ? 0 : 90, bottom: NumberValue === 2 ? 90 : 180, left: 0, right: 100 }) }));
	let Selected = false;
	const Root: any = { ownerDocument: { defaultView: { getSelection: () => ({ rangeCount: Selected ? 1 : 0, toString: () => "math", getRangeAt: () => ({ collapsed: false, commonAncestorContainer: Root, intersectsNode: () => true }) }) } }, contains: () => true, querySelector: () => null, querySelectorAll: () => Pages, getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 100 }) };
	assert.deepEqual(Array.from(location(Root, "当前位置").Pages), [2]);
	Selected = true; const SelectedValue = location(Root, "选区");
	assert.deepEqual(Array.from(SelectedValue.Pages), [1, 2]); assert.equal(SelectedValue.Truncated, true);
	Root.querySelectorAll = () => [];
	assert.throws(() => location(Root, "选区"), /指定页面/);
	Selected = false; assert.throws(() => location(Root, "当前位置"), /指定页面/);
});

test("a full page plus a magnified formula region keeps one PDF page identity and exactly two images", async () =>
{
	const F = reader_fixture(), Version = (await F.Reader.capture(F.File, [1], F.Owner)).Version;
	const Region = { X: 0.1, Y: 0.25, Width: 0.45, Height: 0.12 };
	const Value = await F.Reader.capture(F.File, [{ Number: 1, Kind: "page", Version }, { Number: 1, Kind: "region", Region, Version }], F.Owner);
	assert.equal(Value.Pdf.schemaVersion, 2); assert.deepEqual(Array.from(Value.Pdf.Pages, (P: any) => P.Number), [1, 1]); assert.deepEqual(Array.from(Value.Pdf.Pages, (P: any) => P.Kind), ["page", "region"]); validate_pdf(Value.Pdf);
	const Crop = Value.Pdf.Pages[1]; assert.equal(Crop.Region.PageWidth, 612); assert.equal(Crop.Region.PageHeight, 792); assert.ok(Crop.Region.Scale > 2.5); assert.equal(Crop.TextLayer, false);
	assert.ok(F.RenderOptions.at(-1).transform[4] < 0 && F.RenderOptions.at(-1).transform[5] < 0);
	await assert.rejects(F.Reader.capture(F.File, [1, 2, { Number: 2, Kind: "region", Region }], F.Owner), /最多两张图/);
	await assert.rejects(F.Reader.capture(F.File, [{ Number: 1, Kind: "region", Region, Version: "b".repeat(64) }], F.Owner), /区域选择后已变化/);
	for(const Change of [{ X: -1 }, { Width: 0 }, { X: 0.9, Width: 0.5 }, { X: 0, Y: 0, Width: 1, Height: 1 }]) { assert.throws(() => validate_region({ ...Region, ...Change })); }
	const Controller = new AbortController(); Controller.abort(); await assert.rejects(F.Reader.capture(F.File, [1], F.Owner, "当前位置", "", false, Controller.signal), /已取消/);
	F.Reader.remember_page(F.File, 2); assert.equal(F.Reader.last_page(F.File), 2); assert.equal(F.Reader.last_page({ ...F.File, path: "other.pdf" }), null); F.File.stat.mtime++; assert.equal(F.Reader.last_page(F.File), null); F.Reader.close();
});

test("region cache metadata is validated and stays device-scoped without changing legacy image responses", () =>
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-pdf-region-cache-"));
	try
	{
		const Cache = new BridgePdfImages(join(Directory, "a")), Epoch = Cache.request({ action: "has", ids: [] }).epoch;
		const Origin = { Kind: "region", Region: { X: 0.2, Y: 0.3, Width: 0.5, Height: 0.5, PageWidth: 612, PageHeight: 792, Scale: 4, Rotation: 0 } };
		const Stored = Cache.request({ action: "put", id: Id, data: Data, epoch: Epoch, origin: Origin }); assert.equal(Stored.Kind, "region"); assert.deepEqual(Stored.Region, Origin.Region);
		assert.ok(readFileSync(join(Directory, "a", Id + ".jpeg-data.origin.json"), "utf8").includes('"Kind":"region"'));
		assert.throws(() => Cache.request({ action: "put", id: Id, data: Data, epoch: Epoch, origin: { Kind: "page", Region: Origin.Region } }));
		Cache.request({ action: "clear" }); assert.throws(() => Cache.get(Id));
	}
	finally { rmSync(Directory, { recursive: true, force: true }); }
});
