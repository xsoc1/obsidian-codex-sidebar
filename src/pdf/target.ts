import type { App, TFile } from "obsidian";
import type { PdfRegionInput } from "./types";

type Quad = [number, number, number, number];
export type PdfTarget = { Page: number; Kind: "text"; Values: Quad } | { Page: number; Kind: "rect"; Values: Quad };
export class PdfTextRangeError extends Error {}
const Prefix = "pdf-target-v1:";

function values(Text: string, Integer: boolean): Quad
{
	const Parts = Text.split(","), Pattern = Integer ? /^\d{1,8}$/ : /^-?\d{1,9}(?:\.\d{1,12})?$/;
	if(Parts.length !== 4 || Parts.some(Part => !Pattern.test(Part.trim()))) { throw new Error("PDF 选区坐标无效"); }
	return Parts.map(Number) as Quad;
}

export function pdf_target(Page: number, Kind: PdfTarget["Kind"], Text: string): PdfTarget
{
	const Values = values(Text, Kind === "text");
	const [A, B, C, D] = Values;
	if(!Number.isSafeInteger(Page) || Page < 1 || Page > 10000 ||
		(Kind === "text" ? A > C || A === C && B >= D : A >= C || B >= D))
	{
		throw new Error("PDF 页码、选区方向或范围无效");
	}
	return { Page, Kind, Values };
}

export function pdf_target_subpath(Target: PdfTarget): string
{
	return `#page=${Target.Page}&${Target.Kind === "text" ? "selection" : "rect"}=${Target.Values.join(",")}`;
}

export function validated_pdf_target(Value: unknown): PdfTarget
{
	const Target = Value as Partial<PdfTarget> | null;
	if(!Target || (Target.Kind !== "text" && Target.Kind !== "rect") || typeof Target.Page !== "number" ||
		!Array.isArray(Target.Values) || !Target.Values.every(Part => typeof Part === "number" && Number.isFinite(Part)))
	{
		throw new Error("PDF 选区格式无效");
	}
	return pdf_target(Target.Page, Target.Kind, Target.Values.join(","));
}

export function pdf_anchor(Target: PdfTarget): string
{
	return Prefix + pdf_target_subpath(Target).slice(1);
}

function parse_fragment(Text: string): PdfTarget
{
	const Params = new URLSearchParams(Text), Page = Params.get("page"), TextRange = Params.get("selection"), Rect = Params.get("rect");
	if(!Page || !/^\d{1,5}$/.test(Page) || (TextRange === null) === (Rect === null) ||
		["page", "selection", "rect"].some(Key => Params.getAll(Key).length > 1))
	{
		throw new Error("请粘贴单个 PDF 文字选区或矩形链接");
	}
	return pdf_target(Number(Page), TextRange === null ? "rect" : "text", TextRange ?? Rect!);
}

export function parse_pdf_anchor(Anchor: string | undefined): PdfTarget | null
{
	if(!Anchor?.startsWith(Prefix)) { return null; }
	try { return parse_fragment(Anchor.slice(Prefix.length)); } catch { return null; }
}

export function parse_pdf_link(Input: string): { Path: string; Target: PdfTarget }
{
	const Text = Input.trim();
	if(!Text || Text.length > 8192 || /[\r\n]/.test(Text)) { throw new Error("请粘贴单个 PDF 选区链接"); }
	const Wiki = Text.match(/^!?\[\[([^\[\]]+)\]\]$/), Markdown = Text.match(/^!?\[[^\[\]]*\]\((.+)\)$/);
	const Link = Wiki ? Wiki[1].split("|", 1)[0] : Markdown ? Markdown[1].replace(/^<(.+)>$/, "$1") : Text;
	const At = Link.lastIndexOf("#");
	if(At <= 0) { throw new Error("链接缺少 PDF 页码与选区"); }
	let Path = Link.slice(0, At);
	if(!Wiki)
	{
		try { Path = decodeURIComponent(Path); } catch { throw new Error("PDF 路径编码无效"); }
	}
	if(!/\.pdf$/i.test(Path) || Path !== Path.trim() || /[\\:\u0000-\u001f<>"|?*\[\]]/.test(Path) || Path.split("/").some(Part => !Part || Part.startsWith(".")))
	{
		throw new Error("只支持当前库内的 PDF 文件链接. 如有相对上级路径, 请使用库内完整路径");
	}
	return { Path, Target: parse_fragment(Link.slice(At + 1)) };
}

export function resolve_pdf_file(AppValue: App, Path: string): TFile
{
	const Files = AppValue.vault.getFiles().filter(File => File.extension.toLowerCase() === "pdf" && (File.path === Path || File.path.endsWith("/" + Path)));
	if(Files.length !== 1)
	{
		const Exact = Path.includes("/") ? Files.find(File => File.path === Path) : undefined;
		if(Exact) { return Exact; }
		throw new Error(Files.length ? "有多个同名 PDF, 请粘贴库内完整路径" : "当前库找不到链接所指的 PDF");
	}
	return Files[0];
}

export function pdf_region(Target: Extract<PdfTarget, { Kind: "rect" }>, Viewport: { width: number; height: number; convertToViewportRectangle(Rect: Quad): number[] }): PdfRegionInput
{
	const [A, B, C, D] = Viewport.convertToViewportRectangle(Target.Values);
	const { width: W, height: H } = Viewport;
	const X = Math.min(A, C), Y = Math.min(B, D), Right = Math.max(A, C), Bottom = Math.max(B, D);
	// PDF++ rounds user-space coordinates to integers when copying.
	if(![X, Y, Right, Bottom, W, H].every(Number.isFinite) || W <= 0 || H <= 0 || X < -0.51 || Y < -0.51 || Right > W + 0.51 || Bottom > H + 0.51)
	{
		throw new Error("PDF 矩形超出页面");
	}
	const Left = Math.max(0, X), Top = Math.max(0, Y);
	return { X: Left / W, Y: Top / H, Width: (Math.min(Right, W) - Left) / W, Height: (Math.min(Bottom, H) - Top) / H };
}

export function pdf_selected_text(Target: Extract<PdfTarget, { Kind: "text" }>, Items: { str: string; hasEOL?: boolean }[]): string
{
	const [First, From, Last, To] = Target.Values;
	if(Last >= Items.length || From > Items[First].str.length || To > Items[Last].str.length) { throw new PdfTextRangeError("PDF 文字偏移已失效, 请重新选择"); }
	const Text = Items.slice(First, Last + 1).map((Item, I) =>
		Item.str.slice(I === 0 ? From : 0, First + I === Last ? To : undefined) + (First + I === Last ? "" : Item.hasEOL ? "\n" : " ")).join("").trim();
	if(!Text) { throw new PdfTextRangeError("这个 PDF 选区没有可读文字, 可改用矩形框选"); }
	return Text;
}
