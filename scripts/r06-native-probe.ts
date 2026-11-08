import { loadPdfJs, type App } from "obsidian";
import { PdfReader } from "../src/pdf/reader";
import { jpeg_info, pdf_hash, type PdfImageRef, type PdfImageOrigin } from "../src/pdf/types";
import { source_reference, source_label, open_source } from "../src/sources";

// A caller-owned original PDF; never reads or rewrites a course note.
export async function r06_native_probe(AppValue: App, Bytes: ArrayBuffer, Folder: string)
{
	if(!/^Codex Sidebar 验收-R06-[a-f0-9]{8}$/.test(Folder) || AppValue.vault.getAbstractFileByPath(Folder)) { throw Error("Require a fresh uniquely owned fixture folder"); }
	const Previous = AppValue.workspace.activeLeaf, Images = new Map<string, string>();
	await AppValue.vault.createFolder(Folder);
	const File = await AppValue.vault.createBinary(Folder + "/原创条件.pdf", Bytes);
	const Reader = new PdfReader(AppValue, {
		put: async (Data: string, Origin?: PdfImageOrigin): Promise<PdfImageRef> => { const Id = await pdf_hash(Data); Images.set(Id, Data); return { Id, ...jpeg_info(Data), ...(Origin ?? {}) }; },
		get: async Id => { const Data = Images.get(Id); if(!Data) { throw Error("Missing original test image"); } return Data; },
		clear: async () => { Images.clear(); }
	});
	const Cleanup = async () =>
	{
		Reader.close(); Images.clear();
		for(const Leaf of AppValue.workspace.getLeavesOfType("pdf")) { if((Leaf.view as any).file?.path === File.path) { Leaf.detach(); } }
		if(Previous?.view.containerEl.isConnected) { AppValue.workspace.setActiveLeaf(Previous, { focus: true }); }
		const Owned = AppValue.vault.getAbstractFileByPath(Folder);
		if(Owned?.path === Folder && "children" in Owned && (Owned as any).children.every((C: any) => C.path === File.path)) { await AppValue.vault.delete(Owned, true); }
	};
	try
	{
		const Lib = await loadPdfJs(), PDF = await Lib.getDocument({ data: new Uint8Array(Bytes.slice(0)), isEvalSupported: false }).promise;
		const Items = (await (await PDF.getPage(1)).getTextContent()).items.filter((I: any) => typeof I.str === "string"), Index = Items.findIndex((I: any) => I.str.trim().length > 3);
		if(Index < 0) { throw Error("Original PDF lacks a usable text item"); }
		const To = Math.min(Items[Index].str.length, 16); await PDF.destroy();
		const Selection = await Reader.capture_target(File, { Kind: "text", Page: 1, Values: [Index, 0, Index, To] }, document);
		const Combined = await Reader.capture_same_page_image(Selection, [{ Number: 1, Kind: "region", Region: { X: 0.05, Y: 0.05, Width: 0.8, Height: 0.5 } }], document);
		const Refs = source_reference(Combined), Text = Refs.find(R => !R.ImageKind), Image = Refs.find(R => R.ImageKind);
		if(!Text || !Image || Refs.length !== 2 || Text.Anchor === Image.Anchor) { throw Error("Combined PDF sources are not independent"); }
		const ImageTarget = await open_source(AppValue, Image), TextTarget = await open_source(AppValue, Text);
		if(TextTarget.Status !== "exact" || !TextTarget.Subpath?.includes("selection=") || ImageTarget.Subpath?.includes("selection=")) { throw Error("Native text/image navigation lost its original target"); }
		const Leaf = AppValue.workspace.getLeavesOfType("pdf").filter(L => (L.view as any).file?.path === File.path).at(-1)!;
		await AppValue.workspace.revealLeaf(Leaf); AppValue.workspace.setActiveLeaf(Leaf, { focus: true }); window.focus();
		await new Promise(R => setTimeout(R, 800));
		const Report = { tier: "native PDF.js/canvas and Obsidian source navigation", selectedText: Selection.SelectedText, sources: Refs.map(R => source_label(R, Refs)), imageTarget: ImageTarget.Status, textTarget: TextTarget.Status, textSubpath: TextTarget.Subpath, imageCount: Combined.Pdf?.Pages.length, restoredTextAnchor: Combined.PdfTarget?.Kind === "text", visiblePdf: AppValue.workspace.getLeavesOfType("pdf").some(L => (L.view as any).file?.path === File.path), highlightedNodes: document.querySelectorAll('.pdf-viewer .highlight').length, noInference: true };
		(window as any).__codexR06Cleanup = Cleanup;
		return Report;
	}
	catch(E) { await Cleanup(); throw E; }
}
