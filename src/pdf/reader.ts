import { loadPdfJs, type App, type FileView, type TFile, type View } from "obsidian";
import { bound_text, type ContextSnapshot } from "../prompt";
import { pdf_hash, validate_region, validate_pdf, type PdfCaptureRequest, type PdfRegion } from "./types";
import type { PdfImages } from "./image-store";

export function is_pdf_view(ViewValue: View | null | undefined): ViewValue is FileView & { getViewType(): "pdf" }
{
	return !!ViewValue && ViewValue.getViewType() === "pdf" && (ViewValue as FileView).file?.extension.toLowerCase() === "pdf";
}

export function pdf_location(Root: HTMLElement, Kind: "选区" | "当前位置"): { Pages: number[]; SelectedText: string; Truncated: boolean } | null
{
	const SelectionValue = Root.ownerDocument.defaultView?.getSelection();
	const RangeValue = SelectionValue?.rangeCount ? SelectionValue.getRangeAt(0) : null;
	const Selected = Kind === "选区" && !!RangeValue && !RangeValue.collapsed && Root.contains(RangeValue.commonAncestorContainer) && !!SelectionValue?.toString().trim();
	if(Kind === "选区" && !Selected) { return null; }
	const Bounds = (Root.querySelector(".pdf-viewer-container") ?? Root).getBoundingClientRect();
	const Candidates: { Number: number; Area: number }[] = [];
	for(const Page of Root.querySelectorAll<HTMLElement>(".page[data-page-number]"))
	{
		const NumberValue = Number(Page.dataset.pageNumber);
		if(!Number.isInteger(NumberValue) || NumberValue < 1) { continue; }
		const Rect = Page.getBoundingClientRect();
		const Area = Math.max(0, Math.min(Rect.bottom, Bounds.bottom) - Math.max(Rect.top, Bounds.top)) * Math.max(0, Math.min(Rect.right, Bounds.right) - Math.max(Rect.left, Bounds.left));
		if(Selected ? RangeValue!.intersectsNode(Page) : Area > 0) { Candidates.push({ Number: NumberValue, Area }); }
	}
	if(!Candidates.length)
	{
		if(Selected) { throw new Error("无法定位 PDF 选区页码, 请用“选择 PDF 页”指定页面"); }
		const Input = Root.querySelector<HTMLInputElement>(".page-number-input, #pageNumber, .pdf-toolbar input[type=number]");
		const Page = Number(Input?.value);
		if(!Number.isInteger(Page) || Page < 1) { throw new Error("无法定位当前 PDF 页, 请用“选择 PDF 页”指定页面"); }
		return { Pages: [Page], SelectedText: "", Truncated: false };
	}
	if(!Selected) { Candidates.sort((A, B) => B.Area - A.Area); }
	const Pages = Selected ? [...new Set(Candidates.map(Value => Value.Number))].sort((A, B) => A - B) : [Candidates[0].Number];
	return { Pages: Pages.slice(0, 2), SelectedText: Selected ? SelectionValue!.toString() : "", Truncated: Pages.length > 2 };
}

export class PdfReader
{
	private Documents = new Map<string, Promise<{ Document: any; Version: string }>>();
	private Positions = new Map<string, { Page: number; Stamp: number; Size: number }>();
	private Closed = false;
	constructor(private App: App, private Images: PdfImages, private Load = loadPdfJs) { }

	private async document(File: TFile): Promise<{ Document: any; Version: string }>
	{
		if(this.Closed) { throw new Error("PDF 阅读器已关闭"); }
		if(File.extension.toLowerCase() !== "pdf" || File.stat.size > 80 * 1024 * 1024) { throw new Error("请选择不超过 80 MB 的 PDF"); }
		const Key = File.path + ":" + File.stat.mtime + ":" + File.stat.size;
		let Pending = this.Documents.get(Key);
		if(!Pending)
		{
			Pending = (async () =>
			{
				const BufferValue = await this.App.vault.readBinary(File);
				if(BufferValue.byteLength > 80 * 1024 * 1024) { throw new Error("PDF 超过 80 MB 上限"); }
				const Version = await pdf_hash(BufferValue);
				const Library = await this.Load();
				const Document = await Library.getDocument({ data: new Uint8Array(BufferValue), isEvalSupported: false, enableXfa: false, cMapUrl: "/lib/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/lib/pdfjs/standard_fonts/", wasmUrl: "/lib/pdfjs/wasm/" }).promise;
				if(this.Closed) { await Document.destroy(); throw new Error("PDF 捕获已取消"); }
				if(Document.numPages < 1 || Document.numPages > 10000) { await Document.destroy(); throw new Error("PDF 页数超出支持范围"); }
				return { Document, Version };
			})();
			this.Documents.set(Key, Pending);
			void Pending.catch(() => { if(this.Documents.get(Key) === Pending) { this.Documents.delete(Key); } });
			while(this.Documents.size > 2)
			{
				const First = this.Documents.keys().next().value!;
				const Old = this.Documents.get(First)!; this.Documents.delete(First);
				void Old.then(Value => Value.Document.destroy()).catch(() => {});
			}
		}
		return Pending;
	}

	async page_count(File: TFile): Promise<number>
	{
		return (await this.document(File)).Document.numPages;
	}
	remember_page(File: TFile, Page: number): void { if(Number.isSafeInteger(Page) && Page > 0) { this.Positions.set(File.path, { Page, Stamp: File.stat.mtime, Size: File.stat.size }); } }
	last_page(File: TFile): number | null { const Last = this.Positions.get(File.path); return Last && Last.Stamp === File.stat.mtime && Last.Size === File.stat.size ? Last.Page : null; }
	async image_data(Id: string): Promise<string> { return this.Images.get(Id); }

	async capture(File: TFile, Pages: (number | PdfCaptureRequest)[], OwnerDocument: Document, Kind: "选区" | "当前位置" = "当前位置", SelectedText = "", Truncated = false, Signal?: AbortSignal): Promise<ContextSnapshot>
	{
		if(Signal?.aborted) { throw new Error("PDF 捕获已取消"); }
		const Path = File.path, Stamp = File.stat.mtime, Size = File.stat.size;
		const Loaded = await this.document(File);
		const Requests: (PdfCaptureRequest & { Kind: "page" | "region" })[] = Pages.map(Value => typeof Value === "number" ? { Number: Value, Kind: "page" as const } : { ...Value, Kind: Value.Kind ?? "page" });
		const Keys = new Set<string>(), Regions = Requests.some(R => R.Kind === "region");
		if(!Requests.length || Requests.length > 2 || Requests.some((R, I) => !Number.isInteger(R.Number) || R.Number < 1 || R.Number > Loaded.Document.numPages || (I > 0 && R.Number < Requests[I - 1].Number) || !["page", "region"].includes(R.Kind))) { throw new Error("PDF 页码或图像数量无效, 每次最多两张图 (整页和局部图共同计数)"); }
		for(const R of Requests)
		{
			if(R.Version && R.Version !== Loaded.Version) { throw new Error("PDF 在区域选择后已变化, 请重新预览并选择区域"); }
			if(R.Kind === "region") { validate_region(R.Region!); } else if(R.Region) { throw new Error("整页图不能携带局部裁切区域"); }
			const Key = JSON.stringify([R.Number, R.Kind, R.Region]); if(Keys.has(Key)) { throw new Error("PDF 捕获来源重复"); } Keys.add(Key);
		}
		const Result: NonNullable<ContextSnapshot["Pdf"]>["Pages"] = [];
		const Text: string[] = [];
		for(const Request of Requests)
		{
			if(Signal?.aborted) { throw new Error("PDF 捕获已取消"); }
			const NumberValue = Request.Number;
			const Page = await Loaded.Document.getPage(NumberValue);
			const Content = await Page.getTextContent();
			const PageText = Request.Kind === "region" ? "" : Content.items.map((Item: any) => typeof Item.str === "string" ? Item.str + (Item.hasEOL ? "\n" : " ") : "").join("").trim();
			const Initial = Page.getViewport({ scale: 1 });
			if(![Initial.width, Initial.height].every(Value => Number.isFinite(Value) && Value > 0)) { throw new Error("PDF 页面尺寸无效"); }
			const Region = Request.Region;
			const Scale = Region ? Math.min(20, 1600 / Math.max(Initial.width * Region.Width, Initial.height * Region.Height)) : Math.min(2.5, 1600 / Math.max(Initial.width, Initial.height));
			const Viewport = Page.getViewport({ scale: Scale });
			const Geometry: PdfRegion | undefined = Region ? { ...Region, PageWidth: Initial.width, PageHeight: Initial.height, Scale, Rotation: ((Initial.rotation ?? Page.rotate ?? 0) % 360 + 360) % 360 } : undefined;
			const Canvas = OwnerDocument.createElement("canvas");
			Canvas.width = Math.max(1, Math.floor(Viewport.width * (Region?.Width ?? 1))); Canvas.height = Math.max(1, Math.floor(Viewport.height * (Region?.Height ?? 1)));
			const Context = Canvas.getContext("2d");
			if(!Context) { throw new Error("此设备无法渲染 PDF 页图"); }
			try
			{
				const Render = Page.render({ canvasContext: Context, viewport: Viewport, background: "white", intent: "print", ...(Region ? { transform: [1, 0, 0, 1, -Viewport.width * Region.X, -Viewport.height * Region.Y] } : {}) });
				const Abort = () => Render.cancel(); Signal?.addEventListener("abort", Abort, { once: true });
				let Timer: ReturnType<typeof setTimeout> | undefined;
				try
				{
					await Promise.race([Render.promise, new Promise<never>((_, Reject) => { Timer = setTimeout(() => { Render.cancel(); Reject(new Error("PDF 页图渲染超时, 请减少页面并重试")); }, 30000); })]);
				}
				finally { clearTimeout(Timer); Signal?.removeEventListener("abort", Abort); }
				if(this.Closed || Signal?.aborted) { throw new Error("PDF 捕获已取消"); }
				const Origin = Regions ? { Kind: Request.Kind, ...(Geometry ? { Region: Geometry } : {}) } : undefined;
				const Image = await this.Images.put(Canvas.toDataURL("image/jpeg", 0.88), Origin);
				Result.push({ Number: NumberValue, TextLayer: !!PageText, Image, ...(Origin ?? {}) });
				Text.push(`[PDF 第 ${NumberValue} 页${Region ? " 局部放大图" : " 整页图"}]\n${Region ? "区域只含所选矩形图像, 不将整页文字层冒充为区域文字. 坐标与缩放关系: " + JSON.stringify(Geometry) : PageText || "无可用文字层, 请依据附带页图识读. 不清楚的符号应明确说明."}`);
			}
			finally { Canvas.width = Canvas.height = 0; }
		}
		if(Signal?.aborted || this.Closed || File.path !== Path || File.stat.mtime !== Stamp || File.stat.size !== Size) { throw new Error("PDF 在捕获期间变化或已取消, 请重新捕获"); }
		const Bounded = bound_text(Text.join("\n\n"));
		const Pdf: NonNullable<ContextSnapshot["Pdf"]> = { schemaVersion: Regions ? 2 : 1, ReadOnly: true, PageCount: Loaded.Document.numPages, Pages: Result }; validate_pdf(Pdf); this.remember_page(File, Requests[0].Number);
		return { Path, Mode: "阅读", Kind, Text: Bounded.Text, SelectedText: bound_text(SelectedText, 12000).Text, LineStart: null, LineEnd: null, Heading: `PDF 第 ${Requests.map(R => R.Number).join(", ")} 页${Regions ? " (含局部图)" : ""}`, Mapping: Result.every(Value => Value.TextLayer) ? "PDF文本层" : "PDF页图", CapturedAt: new Date().toISOString(), Truncated: Truncated || Bounded.Truncated || SelectedText.length > 12000, Version: Loaded.Version, Pdf };
	}

	close(): void
	{
		this.Closed = true;
		for(const Pending of this.Documents.values()) { void Pending.then(Value => Value.Document.destroy()).catch(() => {}); }
		this.Documents.clear();
	}
}
