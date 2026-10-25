import type { ContextSnapshot } from "../prompt";
import type { ChatMessage } from "../history";
import { validate_pdf, type PdfImageRef } from "./types";
import { source_path } from "../edit/document";

export function pdf_refs(Context: ContextSnapshot | null | undefined): PdfImageRef[]
{
	if(!Context?.Pdf) { return []; }
	validate_pdf(Context.Pdf);
	source_path(Context.Path);
	if(!Context.Path.toLowerCase().endsWith(".pdf")) { throw new Error("PDF 来源路径与页图不一致"); }
	return Context.Pdf.Pages.map(Page => Page.Image);
}

export function message_pdf_refs(Message: ChatMessage): PdfImageRef[]
{
	const Sources = [Message.Context, Message.Task?.Source, ...(Message.Task?.Prerequisites ?? [])];
	return [...new Map(Sources.flatMap(Source => pdf_refs(Source)).map(Ref => [Ref.Id, Ref])).values()];
}

export function history_pdf_refs(Messages: ChatMessage[]): PdfImageRef[]
{
	const Refs = [...new Map(Messages.filter(Message => Message.Role === "user").flatMap(message_pdf_refs).map(Ref => [Ref.Id, Ref])).values()];
	if(Refs.length > 32) { throw new Error("恢复会话的 PDF 页图超过 32 张, 请新建会话; 原记录保留"); }
	return Refs;
}

export function image_inputs(Refs: PdfImageRef[], Urls: Map<string, string>)
{
	if(Refs.length > 2) { throw new Error("每轮 PDF 提问最多两张页图"); }
	return Refs.map(Ref =>
	{
		const Url = Urls.get(Ref.Id);
		if(!Url) { throw new Error("原 PDF 页图尚未准备, 不会换用当前页面"); }
		return { type: "image", url: Url };
	});
}
