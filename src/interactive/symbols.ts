import type { ContextSnapshot } from "../prompt";
import type { SourceReference } from "../sources";
import { safe_math_markdown } from "../edit/safe-markdown";
import { parse_pdf_anchor, pdf_anchor } from "../pdf/target";

export interface SymbolSpec { id: string; symbol: string; meaning: string; conditions?: string; quote?: string; }
export interface SymbolLocation { Status: "matched" | "unverified" | "ambiguous"; Source?: SourceReference; Quote?: string; Message: string; }

function prose(Text: string): string { return Text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, ""); }

export function validate_symbol(Value: unknown): SymbolSpec
{
	const Limits = { id: 64, symbol: 160, meaning: 4000, conditions: 2000, quote: 512 };
	if(!Value || typeof Value !== "object" || Array.isArray(Value) || ![Object.prototype, null].includes(Object.getPrototypeOf(Value))) { throw Error("符号需要普通对象"); }
	const Result: Record<string, string> = {};
	for(const Key of Reflect.ownKeys(Value))
	{
		if(typeof Key !== "string" || !Object.hasOwn(Limits, Key)) { throw Error("符号含未知字段"); }
		const Descriptor = Object.getOwnPropertyDescriptor(Value, Key)!;
		if(!Object.hasOwn(Descriptor, "value")) { throw Error("符号字段不能是访问器"); }
		const Text: unknown = Descriptor.value;
		if(typeof Text !== "string" || Text.length > Limits[Key as keyof typeof Limits] || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(Text)) { throw Error("符号字段须为限长字符串, 不能含控制字符"); }
		if(["symbol", "meaning", "conditions"].includes(Key) && (!safe_math_markdown(Text) || /!\[|<!--|<!DOCTYPE|<\?/i.test(prose(Text)))) { throw Error("符号说明只允许安全数学 Markdown"); }
		if(Key === "symbol" && (/[\r\n\u2028\u2029]/.test(Text) || /\[\[|\[[^\]]*\]\s*(?:\(|\[|:)|\[\^|(?:https?|obsidian|mailto):|\bwww\./i.test(prose(Text)) || /\\(?:href|url)\b/.test(Text))) { throw Error("符号按钮不能包含链接或换行"); }
		Result[Key] = Text;
	}
	for(const Key of ["id", "symbol", "meaning"]) { if(!Result[Key]?.trim()) { throw Error("符号缺少非空字段 " + Key); } }
	if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(Result.id) || ["__proto__", "constructor", "prototype"].includes(Result.id)) { throw Error("符号标识无效"); }
	return Result as unknown as SymbolSpec;
}

interface Segment
{
	Text: string;
	Key: string;
	From?: number;
	Line?: number;
	Column?: number;
	Exact?: boolean;
}
interface Match { Ref: SourceReference; Origin: string; Key: string; From?: number; Line?: number; Column?: number; Exact?: boolean; }
function line(Value: number | null | undefined): Value is number { return Number.isSafeInteger(Value) && Value! >= 0; }
function unique_at(Text: string, Part: string): number | undefined
{
	if(!Part) { return undefined; }
	const At = Text.indexOf(Part);
	return At >= 0 && Text.indexOf(Part, At + 1) < 0 ? At : undefined;
}
function origin(Ref: SourceReference): string
{
	return JSON.stringify([Ref.Kind, Ref.Path, Ref.PathExact, Ref.CurrentPath, Ref.Version, Ref.VersionKind, Ref.CapturedAt, Ref.Host, Ref.Page, Ref.ImageKind, Ref.Region]);
}
function same_match(A: Match, B: Match): boolean
{
	if(A.Origin !== B.Origin) { return false; }
	if(A.From !== undefined && B.From !== undefined) { return A.From === B.From; }
	if(A.Line !== undefined && B.Line !== undefined && A.Column !== undefined && B.Column !== undefined) { return A.Line === B.Line && A.Column === B.Column; }
	return A.Key === B.Key;
}

function markdown_segments(Context: ContextSnapshot, Ref: SourceReference): Segment[]
{
	const Exact = ["源文本", "源块"].includes(Context.Mapping) && (Ref.Mapping === undefined || Ref.Mapping === Context.Mapping);
	const E = Context.Explanation, EExact = !!E && line(E.From) && E.To - E.From === E.Text.length;
	const Segments: Segment[] = [];
	if(Ref.Purpose === "explanation")
	{
		if(E) { Segments.push({ Text: E.Text, Key: JSON.stringify(["explanation", E.From, E.Text]), ...(EExact ? { From: E.From } : {}), ...(Exact && line(E.LineStart) ? { Line: E.LineStart, Column: E.From === 0 ? 0 : undefined, Exact: true } : {}) }); }
		return Segments;
	}
	let From: number | undefined, Column: number | undefined = 0;
	const S = Context.Selection;
	if(Exact && S && line(S.From))
	{
		if(S.To - S.From === Context.Text.length && (!Context.SelectedText || Context.SelectedText === Context.Text)) { From = S.From; Column = From === 0 ? 0 : undefined; }
		else if(Context.Mapping === "源文本")
		{
			const At = unique_at(Context.Text, Context.SelectedText);
			if(At !== undefined && S.To - S.From >= Context.SelectedText.length && S.From >= At) { From = S.From - At; }
		}
	}
	if(Exact && From === undefined && EExact)
	{
		const InExplanation = unique_at(E!.Text, Context.Text), InText = unique_at(Context.Text, E!.Text);
		if(InExplanation !== undefined) { From = E!.From + InExplanation; }
		else if(InText !== undefined && E!.From >= InText) { From = E!.From - InText; }
	}
	if(Exact && From === undefined && Context.LineStart === 0) { From = 0; }
	Segments.push({ Text: Context.Text, Key: JSON.stringify(["text", Context.LineStart, Context.Text]), ...(Exact ? { From, Line: line(Context.LineStart) ? Context.LineStart : undefined, Column, Exact: true } : {}) });
	// Precise selected text can outlive the bounded source-line prefix. Rendered
	// selections are not original Markdown and must never acquire source offsets.
	if(Exact && Context.Mapping === "源文本" && Context.SelectedText && !Context.Text.includes(Context.SelectedText))
	{
		Segments.push({ Text: Context.SelectedText, Key: JSON.stringify(["selection", S?.From, Context.SelectedText]), From: S?.From, Line: line(Context.LineStart) ? Context.LineStart : undefined, Exact: true });
	}
	return Segments;
}

function pdf_segments(Context: ContextSnapshot, Ref: SourceReference): Segment[]
{
	const Target = Context.PdfTarget, Parsed = parse_pdf_anchor(Ref.Anchor);
	if(!Ref.ImageKind && Target?.Kind === "text" && Parsed?.Kind === "text" && Ref.Page === Target.Page && Ref.Anchor === pdf_anchor(Target))
	{
		const Text = Context.Text.includes(Context.SelectedText) ? Context.Text : Context.SelectedText;
		return [{ Text, Key: "pdf-text:" + Ref.Anchor }];
	}
	const Pages = Context.Pdf?.Pages, Page = Pages?.find(P => P.Number === Ref.Page && (P.Kind ?? "page") === (Ref.ImageKind ?? "page"));
	if(!Pages || !Page?.TextLayer || Page.Kind === "region") { return []; }
	// Native PDF capture surrounds page text with host labels. These labels and
	// the no-OCR/crop instructions are not PDF text and cannot verify a quote.
	const Headers = [...Context.Text.matchAll(/^\[PDF 第 (\d+) 页( 整页图| 局部放大图)?\]\r?\n/gm)];
	if(Headers.length)
	{
		if(Headers.length > Pages.length || Headers.some((H, I) => Number(H[1]) !== Pages[I].Number || (H[2] === " 局部放大图") !== (Pages[I].Kind === "region"))) { return []; }
		const Index = Headers.findIndex(H => Number(H[1]) === Ref.Page && H[2] !== " 局部放大图");
		if(Index < 0) { return []; }
		const H = Headers[Index], Next = Headers[Index + 1];
		const Text = Context.Text.slice(H.index! + H[0].length, Next ? Next.index! - 2 : undefined);
		return [{ Text, Key: "pdf-page:" + Ref.Page }];
	}
	return Pages.length === 1 ? [{ Text: Context.Text, Key: "pdf-page:" + Ref.Page }] : [];
}

/** Verifies literal provenance only; model-provided meanings never become facts. */
export function locate_symbol(Spec: SymbolSpec, Contexts: readonly ContextSnapshot[], Refs: readonly SourceReference[]): SymbolLocation
{
	const Quote = validate_symbol(Spec).quote;
	if(!Quote?.trim()) { return { Status: "unverified", Message: "AI 补充说明, 未提供逐字引用; 来源未核验." }; }
	const Matches: Match[] = [];
	const Add = (Ref: SourceReference, Segment: Segment) =>
	{
		for(let At = Segment.Text.indexOf(Quote); At >= 0 && Matches.length < 2; At = Segment.Text.indexOf(Quote, At + 1))
		{
			const Before = Segment.Text.slice(0, At), Newlines = Before.split("\n").length - 1;
			const M: Match = { Ref, Origin: origin(Ref), Key: Segment.Key + ":" + At, From: Segment.From === undefined ? undefined : Segment.From + At, Line: Segment.Line === undefined ? undefined : Segment.Line + Newlines, Column: Newlines ? At - Before.lastIndexOf("\n") - 1 : Segment.Column === undefined ? undefined : Segment.Column + At, Exact: Segment.Exact };
			const Existing = Matches.find(Value => same_match(Value, M));
			if(!Existing) { Matches.push(M); }
			else if(!Existing.Exact && M.Exact) { Object.assign(Existing, M); }
			if(Matches.length > 1) { return; }
		}
	};
	for(const Ref of Refs)
	{
		if(Matches.length > 1) { break; }
		if(Ref.Kind === "tool-read")
		{
			if(Ref.Anchor) { Add(Ref, { Text: Ref.Anchor, Key: JSON.stringify(["tool-anchor", Ref.Range?.From, Ref.Anchor]), From: Ref.Range?.From }); }
			continue;
		}
		// ContextSnapshot is captured on the client. A Windows/unknown-host read
		// must prove its own text, not borrow matching paths from a client snapshot.
		if(Ref.Host !== "client-snapshot") { continue; }
		for(const Context of Contexts)
		{
			if(Context.Path !== Ref.Path || Context.Version !== Ref.Version || Context.CapturedAt !== Ref.CapturedAt) { continue; }
			for(const Segment of Ref.Kind === "pdf" ? pdf_segments(Context, Ref) : Context.Pdf || Context.PdfTarget ? [] : markdown_segments(Context, Ref)) { Add(Ref, Segment); }
		}
	}
	if(Matches.length > 1) { return { Status: "ambiguous", Quote, Message: "引用在已提供内容中重复出现或对应多个来源, 无法唯一定位; 未选择某一处." }; }
	if(!Matches.length) { return { Status: "unverified", Quote, Message: "未在宿主来源对应的快照或实际补读片段中找到逐字引用; 来源未核验. 图像识读不作为文字核验." }; }
	const M = Matches[0], Source = structuredClone(M.Ref);
	if(Source.Kind === "markdown" && M.Exact && M.Line !== undefined)
	{
		Source.Anchor = Quote; Source.LineStart = M.Line; Source.LineEnd = M.Line + Quote.split("\n").length - 1;
	}
	const Host = Source.Host === "windows-copy" ? "Windows 副本的实际补读片段" : Source.Host === "desktop-read" ? "桌面实际补读片段" : Source.Host === "client-snapshot" ? "客户端当时快照" : "宿主未知的已读片段";
	return { Status: "matched", Source, Quote, Message: `逐字引用已在${Host}中核验${Source.Truncated ? " (来源已截断, 仅核验已有片段)" : ""}; 含义和条件仍为 AI 说明.` };
}
