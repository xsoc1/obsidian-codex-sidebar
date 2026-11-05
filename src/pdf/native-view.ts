import type { FileView } from "obsidian";
import { pdf_target, type PdfTarget } from "./target";

export interface PdfViewport
{
	width: number;
	height: number;
	rotation: number;
	convertToPdfPoint(X: number, Y: number): number[];
}

interface PdfViewerChild
{
	file?: FileView["file"];
	pdfViewer?: { pdfViewer?: { getPageView?(Index: number): { div: HTMLElement; viewport?: PdfViewport } | undefined } };
	getTextSelectionRangeStr?(Page: HTMLElement): unknown;
}

export function pdf_viewer_child(View: FileView): PdfViewerChild | undefined
{
	const Child = (View as FileView & { viewer?: { child?: PdfViewerChild } }).viewer?.child;
	return View.file && Child?.file === View.file ? Child : undefined;
}

export function native_pdf_text_target(View: FileView, Page: number): PdfTarget | null
{
	if(!Number.isSafeInteger(Page) || Page < 1) { return null; }
	const PageElement = View.containerEl.querySelector<HTMLElement>(`.pdf-viewer-container .page[data-page-number="${Page}"]`);
	if(!PageElement) { return null; }
	try
	{
		const Range = pdf_viewer_child(View)?.getTextSelectionRangeStr?.(PageElement);
		return typeof Range === "string" ? pdf_target(Page, "text", Range) : null;
	}
	catch { return null; } // The built-in reader without precise offsets still supports page capture.
}
