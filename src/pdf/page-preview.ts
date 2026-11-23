import { loadPdfJs, type App, type TFile } from "obsidian";

export const PdfByteLimit = 80 * 1024 * 1024;

export function pdf_document_task(Library: Awaited<ReturnType<typeof loadPdfJs>>, Bytes: ArrayBuffer)
{
	return Library.getDocument({ data: new Uint8Array(Bytes), isEvalSupported: false, enableXfa: false, cMapUrl: "/lib/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/lib/pdfjs/standard_fonts/", wasmUrl: "/lib/pdfjs/wasm/" });
}

/** Display one linked page without capturing, indexing, or retaining any model attachment. */
export async function render_pdf_page(AppValue: App, File: TFile, NumberValue: number, Canvas: HTMLCanvasElement, Signal: AbortSignal): Promise<void>
{
	if(!Number.isSafeInteger(NumberValue) || NumberValue < 1) { throw Error("PDF 链接页码无效"); }
	if(File.stat.size > PdfByteLimit) { throw Error("超过 80 MB 的 PDF 请打开原文阅读"); }
	const Path = File.path, Stamp = File.stat.mtime, Size = File.stat.size;
	const Check = () =>
	{
		if(Signal.aborted || File.path !== Path || File.stat.mtime !== Stamp || File.stat.size !== Size) { throw Error("PDF 已变化或预览已关闭"); }
	};
	const Bytes = await AppValue.vault.readBinary(File);
	if(Bytes.byteLength > PdfByteLimit) { throw Error("超过 80 MB 的 PDF 请打开原文阅读"); }
	Check();
	const Library = await loadPdfJs();
	Check();
	const Loading = pdf_document_task(Library, Bytes);
	let Destroyed: Promise<unknown> | undefined;
	const Release = () => { Destroyed ??= Loading.destroy().catch(() => {}); };
	Signal.addEventListener("abort", Release, { once: true });
	try
	{
		const Document = await Loading.promise;
		Check();
		if(NumberValue > Document.numPages) { throw Error("PDF 链接页码超出文件范围"); }
		const Page = await Document.getPage(NumberValue), Base = Page.getViewport({ scale: 1 });
		Check();
		const Viewport = Page.getViewport({ scale: Math.min(2, 1_200 / Math.max(Base.width, Base.height)) });
		Canvas.width = Math.ceil(Viewport.width); Canvas.height = Math.ceil(Viewport.height);
		const Context = Canvas.getContext("2d");
		if(!Context) { throw Error("当前设备无法绘制 PDF 页"); }
		await Page.render({ canvasContext: Context, viewport: Viewport, background: "white", intent: "print" }).promise;
		Check();
	}
	finally { Signal.removeEventListener("abort", Release); Release(); await Destroyed; }
}
