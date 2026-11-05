import type { FileView } from "obsidian";
import { pdf_target, type PdfTarget } from "./target";
import { pdf_viewer_child, type PdfViewport } from "./native-view";

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };
export type PdfBox = { Target: Extract<PdfTarget, { Kind: "rect" }>; Rotation: number };

function inside(B: Bounds, P: Point): boolean
{
	return P.x >= B.left && P.x <= B.left + B.width && P.y >= B.top && P.y <= B.top + B.height;
}

export function pdf_box_target(Page: number, Box: Bounds, Start: Point, End: Point, View: PdfViewport): PdfBox
{
	if(![Box.width, Box.height, View.width, View.height].every(N => Number.isFinite(N) && N > 0) || !inside(Box, Start) || !inside(Box, End))
	{
		throw new Error("请在同一张 PDF 页内框选");
	}
	if(Math.abs(Start.x - End.x) < 6 || Math.abs(Start.y - End.y) < 6) { throw new Error("区域太小，请重新拖动框选"); }
	const Rotation = ((View.rotation % 360) + 360) % 360;
	if(![0, 90, 180, 270].includes(Rotation)) { throw new Error("无法识别当前 PDF 页的旋转角度"); }
	const Convert = (P: Point) => View.convertToPdfPoint((P.x - Box.left) * View.width / Box.width, (P.y - Box.top) * View.height / Box.height);
	const [A, B] = Convert(Start), [C, D] = Convert(End);
	const Values = [Math.min(A, C), Math.min(B, D), Math.max(A, C), Math.max(B, D)].map(N => N.toFixed(6));
	return { Target: pdf_target(Page, "rect", Values.join(",")) as PdfBox["Target"], Rotation };
}

interface PageHit { Number: number; Element: HTMLElement; Surface: HTMLElement; Viewport: PdfViewport; Bounds: DOMRect; }
function page_hit(View: FileView, Scroller: HTMLElement, Start: Point): PageHit | null
{
	if(!inside(Scroller.getBoundingClientRect(), Start)) { return null; }
	const Viewer = pdf_viewer_child(View)?.pdfViewer?.pdfViewer;
	for(const ElementValue of Scroller.querySelectorAll<HTMLElement>(".page[data-page-number]"))
	{
		if(!inside(ElementValue.getBoundingClientRect(), Start)) { continue; }
		const NumberValue = Number(ElementValue.dataset.pageNumber);
		if(!Number.isSafeInteger(NumberValue) || NumberValue < 1) { return null; }
		const Page = Viewer?.getPageView?.(NumberValue - 1);
		const Surface = ElementValue.querySelector<HTMLElement>(":scope > .canvasWrapper");
		if(!Page?.viewport || Page.div !== ElementValue || !Surface) { return null; }
		const BoundsValue = Surface.getBoundingClientRect();
		return inside(BoundsValue, Start) ? { Number: NumberValue, Element: ElementValue, Surface, Viewport: Page.viewport, Bounds: BoundsValue } : null;
	}
	return null;
}

function same_bounds(A: Bounds, B: Bounds): boolean
{
	return (["left", "top", "width", "height"] as const).every(Key => Math.abs(A[Key] - B[Key]) < 0.5);
}

// An overlay exists only while the user has explicitly armed the one-shot gesture.
export function select_pdf_box(View: FileView, Signal: AbortSignal, Cancel: () => void, Accept: (Box: PdfBox) => void): void
{
	const Root = View.containerEl, Doc = Root.ownerDocument;
	const Scroller = Root.querySelector<HTMLElement>(".pdf-viewer-container"), Host = Scroller?.parentElement;
	if(Signal.aborted) { return; }
	if(!Root.isConnected || !Scroller || !Host) { throw new Error("PDF 阅读器尚未就绪，请先打开 PDF 再框选"); }
	const Layer = Doc.createElement("div"), Bar = Doc.createElement("div"), Status = Doc.createElement("span");
	const Close = Doc.createElement("button"), Outline = Doc.createElement("div");
	Layer.className = "codex-pdf-box"; Bar.className = "codex-pdf-box-bar"; Outline.className = "codex-pdf-box-outline";
	Close.type = "button"; Close.textContent = "取消"; Status.setAttribute("role", "status");
	const Guidance = "在同一页拖动，松手附到侧栏";
	Status.textContent = Guidance; Outline.hidden = true;
	Bar.append(Status, Close); Layer.append(Bar, Outline); Host.appendChild(Layer);
	const Events = new AbortController(), Options = { signal: Events.signal };
	let Drag: { Id: number; Start: Point; Page: PageHit } | null = null;
	const PointOf = (EventValue: PointerEvent): Point => ({ x: EventValue.clientX, y: EventValue.clientY });
	const Remove = () =>
	{
		Events.abort();
		Signal.removeEventListener("abort", Remove);
		Layer.remove();
	};
	const Reset = (Message: string) =>
	{
		Drag = null; Outline.hidden = true; Status.textContent = Message;
	};
	Signal.addEventListener("abort", Remove, { once: true });
	Close.addEventListener("click", Cancel, Options);
	Doc.addEventListener("keydown", E =>
	{
		if(E.key === "Escape") { E.preventDefault(); E.stopPropagation(); Cancel(); }
	}, { ...Options, capture: true });
	Layer.addEventListener("pointerdown", E =>
	{
		if(Bar.contains(E.target as Node) || E.button !== 0 || !E.isPrimary || Drag) { return; }
		E.preventDefault(); E.stopPropagation();
		const Start = PointOf(E), Page = page_hit(View, Scroller, Start);
		if(!Page) { Reset("请从已显示的 PDF 页面内开始拖动"); return; }
		Layer.setPointerCapture(E.pointerId);
		Drag = { Id: E.pointerId, Start, Page }; Status.textContent = Guidance;
	}, Options);
	Layer.addEventListener("pointermove", E =>
	{
		if(!Drag || E.pointerId !== Drag.Id) { return; }
		E.stopPropagation();
		const { x, y } = PointOf(E), Start = Drag.Start, BoundsValue = Layer.getBoundingClientRect();
		Object.assign(Outline.style, { left: `${Math.min(x, Start.x) - BoundsValue.left}px`, top: `${Math.min(y, Start.y) - BoundsValue.top}px`, width: `${Math.abs(x - Start.x)}px`, height: `${Math.abs(y - Start.y)}px` });
		Outline.hidden = false;
	}, Options);
	Layer.addEventListener("pointerup", E =>
	{
		if(!Drag || E.pointerId !== Drag.Id) { return; }
		E.preventDefault(); E.stopPropagation();
		const { Start, Page } = Drag, End = PointOf(E);
		let Box: PdfBox;
		try
		{
			const Live = page_hit(View, Scroller, Start);
			if(Live?.Element !== Page.Element || Live.Surface !== Page.Surface || Live.Viewport !== Page.Viewport ||
				!same_bounds(Live.Bounds, Page.Bounds)) { throw new Error("页面或缩放已变化，请重新框选"); }
			if(!inside(Scroller.getBoundingClientRect(), End)) { throw new Error("请在当前可见的 PDF 页面内完成框选"); }
			Box = pdf_box_target(Page.Number, Page.Bounds, Start, End, Page.Viewport);
		}
		catch(ErrorValue) { Reset(ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue)); return; }
		Drag = null; Remove(); Accept(Box);
	}, Options);
	const Interrupt = (E: PointerEvent) =>
	{
		if(Drag?.Id === E.pointerId) { E.stopPropagation(); Reset("框选已中断，请重新拖动或取消"); }
	};
	Layer.addEventListener("pointercancel", Interrupt, Options);
	Layer.addEventListener("lostpointercapture", Interrupt, Options);
	Close.focus({ preventScroll: true });
}
