import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { jpeg_info, pdf_hash, pdf_reference, reference_id, validate_pdf } from "../src/pdf/types";
import { BridgePdfImages } from "../src/pdf/bridge-cache";
import { image_inputs, message_pdf_refs, history_pdf_refs } from "../src/pdf/inputs";
import { branch_prefix, history_items } from "../src/history";
import { build_prompt, type ContextSnapshot } from "../src/prompt";
import { note_path, source_path } from "../src/edit/document";

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
	runInNewContext(Bundle, { module: Export, exports: Export.exports, crypto: webcrypto, TextEncoder, Uint8Array, atob, setTimeout, clearTimeout, require: () => ({ loadPdfJs: () => { throw new Error("supply fixture loader"); } }) });
	const File: any = { path: "original.pdf", extension: "pdf", stat: { mtime: 1, size: 100 } };
	let Loads = 0, Renders = 0;
	const Images: any = { put: async () => Ref };
	const Reader = new Export.exports.PdfReader({ vault: { readBinary: async () => new ArrayBuffer(100) } }, Images, async () => ({ getDocument: (Params: any) =>
	{
		assert.equal(Params.isEvalSupported, false); assert.equal(Params.cMapPacked, true); assert.equal(Params.cMapUrl, "/lib/pdfjs/cmaps/"); Loads++;
		return { promise: Promise.resolve({ numPages: 3, destroy: async () => {}, getPage: async () => ({ getTextContent: async () => ({ items: Scanned ? [] : [{ str: "[X,Y]=2Y", hasEOL: true }] }), getViewport: ({ scale }: any) => ({ width: 612 * scale, height: 792 * scale }), render: (Options: any) => { assert.equal(Options.intent, "print"); Renders++; return { promise: Promise.resolve(), cancel: () => {} }; } }) }) };
	} }));
	const Canvas: any = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => Data };
	return { Reader, File, Owner: { createElement: () => Canvas }, Canvas, counts: () => ({ Loads, Renders }), location: Export.exports.pdf_location };
}

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
