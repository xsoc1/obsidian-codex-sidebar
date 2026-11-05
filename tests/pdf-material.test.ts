import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { pdf_target } from "../src/pdf/target";

function fixture()
{
	const Bundle = buildSync({ entryPoints: ["src/pdf/reader.ts"], bundle: true, write: false, platform: "browser", format: "cjs", external: ["obsidian"] }).outputFiles[0].text, Module = { exports: {} as any };
	runInNewContext(Bundle, { module: Module, exports: Module.exports, crypto: webcrypto, TextEncoder, Uint8Array, structuredClone, setTimeout, clearTimeout, require: () => ({}) });
	const File = { path: "selected.pdf", extension: "pdf", stat: { mtime: 1, size: 100 } }, Data = new Map<string, string>(), Rendered: any[] = [];
	let Byte = 0, ImageCount = 0;
	const Canvas: any = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => "canvas-data" };
	const Reader = new Module.exports.PdfReader({ vault: { getFileByPath: (Path: string) => Path === File.path ? File : null, readBinary: async () => new Uint8Array([Byte]).buffer } }, { get: async (Id: string) => { if(!Data.has(Id)) { throw Error("original image missing"); } return Data.get(Id); }, put: async (_Data: string, Origin: any) => { const Id = String(++ImageCount).repeat(64); Data.set(Id, "canvas-data"); return { Id, Width: Canvas.width, Height: Canvas.height, Bytes: 100, ...Origin }; } }, async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 5, destroy: async () => {}, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "alpha beta gamma" }] }), getViewport: ({ scale, rotation = 0 }: any) => ({ width: (rotation === 90 ? 400 : 200) * scale, height: (rotation === 90 ? 200 : 400) * scale, rotation }), render: (Options: any) => { Rendered.push(Options); return { promise: Promise.resolve(), cancel() {} }; } }) }) }) }));
	return { Reader, File, Data, Rendered, Owner: { createElement: () => Canvas }, change: () => { Byte++; File.stat.mtime++; } };
}

test("reader keeps exact PDF text selection and verifies same-page image version before combining", async () =>
{
	const F = fixture();
	try
	{
		const Selected = await F.Reader.capture_target(F.File, pdf_target(3, "text", "0,0,0,5"), F.Owner, undefined, "alpha");
		const Combined = await F.Reader.capture_same_page_image(Selected, [{ Number: 3, Kind: "region", Region: { X: 0.1, Y: 0.1, Width: 0.5, Height: 0.3 }, Rotation: 90 }], F.Owner);
		assert.equal(Combined.SelectedText, "alpha"); assert.deepEqual(Combined.PdfTarget, Selected.PdfTarget); assert.equal(Combined.Pdf.Pages[0].Number, 3); assert.equal(Combined.Pdf.Pages[0].Region.Rotation, 90);
		await F.Reader.verify_snapshot(Combined); F.Data.clear(); await assert.rejects(F.Reader.verify_snapshot(Combined), /original image missing/);
		await assert.rejects(F.Reader.capture_same_page_image(Selected, [4], F.Owner), /实际页码/);
		F.change(); await assert.rejects(F.Reader.capture_same_page_image(Selected, [3], F.Owner), /已变化/); assert.equal(F.Rendered.length, 1);
		await assert.rejects(F.Reader.verify_snapshot(Selected), /已变化或缺失/); assert.equal(Selected.Pdf, undefined);
	}
	finally { F.Reader.close(); }
});
