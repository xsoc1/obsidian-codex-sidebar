import type { AnswerQuote, ContextSnapshot } from "./prompt";
import { validate_pdf } from "./pdf/types";

export interface ComposerMaterial
{
	Context: ContextSnapshot | null;
	Quote: AnswerQuote | null;
	ContextOrigin?: "explicit" | "automatic";
}
export interface CapturedMaterial { Scope: string; SessionId: string; Snapshot: ContextSnapshot; }
export interface MaterialInput
{
	Scope: string;
	SessionId: string;
	AttachContext: boolean;
	Automatic: ContextSnapshot | null;
	Attachment: CapturedMaterial | null;
	Quote: AnswerQuote | null;
}
export interface ResolvedMaterial extends ComposerMaterial { ImageCount: number; Issues: string[]; }

export function resolve_material(Input: MaterialInput): ResolvedMaterial
{
	const Quote = Input.Quote?.SessionId === Input.SessionId ? Input.Quote : null;
	const Explicit = Input.Attachment?.Scope === Input.Scope && Input.Attachment.SessionId === Input.SessionId ? Input.Attachment.Snapshot : null;
	const Context = Input.AttachContext ? Explicit ?? (!Input.Quote ? Input.Automatic : null) : null;
	const Issues: string[] = [];
	if(Input.Quote && !Quote) { Issues.push("引用不属于当前会话, 请返回原会话核对"); }
	if(Context?.Pdf) { try { validate_pdf(Context.Pdf); } catch(ErrorValue) { Issues.push(String(ErrorValue)); } }
	return { Context, Quote, ...(Context ? { ContextOrigin: Explicit ? "explicit" as const : "automatic" as const } : {}), ImageCount: Context?.Pdf?.Pages.length ?? 0, Issues };
}

export function combine_pdf_image(Selection: ContextSnapshot, Image: ContextSnapshot): ContextSnapshot
{
	const Target = Selection.PdfTarget;
	if(Target?.Kind !== "text" || !Selection.SelectedText || !Selection.Version || Selection.Path !== Image.Path || Selection.Version !== Image.Version)
	{
		throw new Error("补图需与原 PDF 文字选区的路径、内容版本一致; 原选择保留");
	}
	if(!Image.Pdf || Image.Pdf.Pages.some(Page => Page.Number !== Target.Page) || Selection.Pdf?.Pages.some(Page => Page.Number !== Target.Page))
	{
		throw new Error("只能补充原文字选区的同一实际 PDF 页, 未按当前页自动合并; 原选择保留");
	}
	validate_pdf(Image.Pdf);
	if(Selection.Pdf) { validate_pdf(Selection.Pdf); }
	if(Selection.Pdf && Selection.Pdf.PageCount !== Image.Pdf.PageCount) { throw new Error("PDF 页数与原选择不一致; 原选择保留"); }
	const Pages = [...(Selection.Pdf?.Pages ?? []), ...Image.Pdf.Pages].map(Page => ({ ...Page, Kind: Page.Kind ?? "page" as const }));
	if(Pages.length > 2) { throw new Error("本轮整页图与局部图合计最多两张; 原选择和已有图片保留"); }
	const Pdf = { schemaVersion: 2 as const, ReadOnly: true as const, PageCount: Image.Pdf.PageCount, Pages };
	validate_pdf(Pdf);
	return { ...structuredClone(Selection), Pdf: structuredClone(Pdf) };
}

export function context_completeness(Snapshot: ContextSnapshot): { Selection: string; Background: string }
{
	const Selected = Snapshot.SelectedTruncated;
	return {
		Selection: Selected === undefined ? Snapshot.Truncated ? "选区完整性未单独记录" : "选区完整" : Selected ? "选区已截断" : "选区完整",
		Background: Snapshot.ContextTruncated === true ? "来源片段已截断" : Snapshot.ContextTruncated === false ? "来源片段完整" : Snapshot.Truncated ? "来源片段可能已截断" : "来源片段完整"
	};
}
