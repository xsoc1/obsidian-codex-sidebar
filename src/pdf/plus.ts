import type { App } from "obsidian";
import { pdf_target, type PdfTarget } from "./target";

type PdfPlus = { lib?: { getPDFViewerChildAssociatedWithNode?(NodeValue: Node): { getTextSelectionRangeStr?(Page: HTMLElement): unknown } | undefined } };

function pdf_plus(AppValue: App): PdfPlus | null
{
	return (AppValue as App & { plugins?: { getPlugin?(Id: string): PdfPlus | null } }).plugins?.getPlugin?.("pdf-plus") ?? null;
}

export function pdf_plus_active(AppValue: App): boolean { return !!pdf_plus(AppValue); }

export function live_pdf_target(AppValue: App, Root: HTMLElement, Page: number): PdfTarget | null
{
	const Lib = pdf_plus(AppValue)?.lib;
	if(!Lib || !Number.isSafeInteger(Page) || Page < 1) { return null; }
	const PageEl = Root.querySelector<HTMLElement>(`.page[data-page-number="${Page}"]`);
	if(!PageEl) { return null; }
	try
	{
		const Range = Lib.getPDFViewerChildAssociatedWithNode?.(PageEl)?.getTextSelectionRangeStr?.(PageEl);
		return typeof Range === "string" ? pdf_target(Page, "text", Range) : null;
	}
	catch { return null; } // A different PDF++/Obsidian viewer keeps the existing capture path.
}
