import { bound_text, type AnswerQuote } from "./prompt";
import type { ChatMessage } from "./history";
import { context_window, markdown_blocks, text_identity, type MarkdownBlock } from "./markdown-blocks";

export interface QuoteLocation
{
	Range?: { From: number; To: number };
	BlockIds?: string[];
	Mapping?: AnswerQuote["Mapping"];
	SourcePath?: string;
	RootMessageId?: string;
	ParentMessageId?: string;
	SourceReferences?: AnswerQuote["SourceReferences"];
}

function plain(Text: string): string { return Text.replace(/!?(?:\[([^\]]+)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g, (_A, B, C, D) => B ?? D ?? C).replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim(); }
function compatible(Node: Element, Block: MarkdownBlock): boolean
{
	if(Block.Kind === "math") { return !!Node.querySelector("mjx-container,.math-block,.math-display") || Node.matches("mjx-container,.math-block,.math-display"); }
	if(Block.Kind === "code") { return Node.tagName === "PRE"; }
	if(Block.Kind === "heading") { return /^H[1-6]$/.test(Node.tagName) && plain(Block.Text.replace(/^\s*#{1,6}\s/, "")) === plain(Node.textContent ?? ""); }
	if(Block.Kind === "list") { return ["UL", "OL"].includes(Node.tagName); }
	if(Block.Kind === "table") { return Node.tagName === "TABLE" || !!Node.querySelector("table"); }
	if(Block.Kind === "callout") { return Node.tagName === "BLOCKQUOTE" || Node.classList.contains("callout"); }
	if(Node.tagName !== "P") { return false; }
	if(plain(Block.Text) === plain(Node.textContent ?? "")) { return true; }
	return !!Node.querySelector("mjx-container,.math-inline") && Block.Text.includes("$");
}

export function bind_answer_blocks(Root: HTMLElement, Markdown: string): boolean
{
	const Blocks = markdown_blocks(Markdown), Nodes = [...Root.children].filter(N => !N.matches(".copy-code-button,.mod-footer"));
	Root.dataset.codexAnswerVersion = text_identity(Markdown);
	for(const N of Root.querySelectorAll<HTMLElement>("[data-codex-answer-block]")) { delete N.dataset.codexAnswerBlock; delete N.dataset.codexAnswerFrom; delete N.dataset.codexAnswerTo; }
	if(Nodes.length !== Blocks.length || !Nodes.every((N, I) => compatible(N, Blocks[I]))) { return false; }
	Nodes.forEach((N, I) => { const ElementValue = N as HTMLElement, Block = Blocks[I]; ElementValue.dataset.codexAnswerBlock = Block.Id; ElementValue.dataset.codexAnswerFrom = String(Block.From); ElementValue.dataset.codexAnswerTo = String(Block.To); });
	return true;
}

export function quote_blocks(Root: HTMLElement, Range: Range, Markdown: string): QuoteLocation
{
	if(!Root.contains(Range.commonAncestorContainer) || Root.dataset.codexAnswerVersion !== text_identity(Markdown)) { return { Mapping: "unknown" }; }
	const Known = new Map(markdown_blocks(Markdown).map(B => [B.Id, B]));
	const Selected = [...Root.querySelectorAll<HTMLElement>("[data-codex-answer-block]")].filter(E => Range.intersectsNode(E)).map(E => Known.get(E.dataset.codexAnswerBlock ?? "")).filter((B): B is MarkdownBlock => !!B);
	if(!Selected.length) { return { Mapping: "unknown" }; }
	return { Mapping: "source-blocks", Range: { From: Math.min(...Selected.map(B => B.From)), To: Math.max(...Selected.map(B => B.To)) }, BlockIds: Selected.map(B => B.Id) };
}

export function answer_status(Message: ChatMessage, ActiveTurn: string | null, Busy: boolean): AnswerQuote["SourceStatus"]
{
	if(Message.Phase === "commentary") { return "incomplete"; }
	if(Message.CompletionStatus === "completed") { return "completed"; }
	if(Message.CompletionStatus || (Busy && Message.TurnId === ActiveTurn)) { return "incomplete"; }
	return "unknown";
}

export function answer_quote(SessionId: string, MessageId: string, SelectedText: string, SourceText: string, SourceStatus: AnswerQuote["SourceStatus"] = "unknown", Location: QuoteLocation = {}): AnswerQuote
{
	const Selected = bound_text(SelectedText.trim(), 4000);
	let Range = Location.Range, Mapping = Location.Mapping ?? "unknown";
	if(Range && (!Number.isSafeInteger(Range.From) || !Number.isSafeInteger(Range.To) || Range.From < 0 || Range.To < Range.From || Range.To > SourceText.length)) { Range = undefined; Mapping = "unknown"; }
	if(!Range && SelectedText.trim())
	{
		const From = SourceText.indexOf(SelectedText.trim());
		if(From >= 0 && SourceText.indexOf(SelectedText.trim(), From + 1) < 0) { Range = { From, To: From + SelectedText.trim().length }; Mapping = "source-blocks"; }
	}
	const Window = Range ? context_window(SourceText, Range.From, Range.To) : null;
	const Source = SourceText.length <= 24000 ? { Text: SourceText, Truncated: false } : Window ? { Text: Window.Text, Truncated: true } : bound_text(SourceText, 24000);
	const Included = markdown_blocks(SourceText).filter(B => B.To > (Window?.From ?? 0) && B.From < (Window?.To ?? Source.Text.length));
	return { SessionId, MessageId, SelectedText: Selected.Text, SourceText: Source.Text, SelectedTruncated: Selected.Truncated, SourceTruncated: Source.Truncated, FollowupMode: "integrated-v1", SourceStatus, SourceVersion: text_identity(SourceText), Mapping: SourceText.length <= 24000 && !Range ? "full-answer" : Mapping, SourceRange: { From: SourceText.length <= 24000 ? 0 : Window?.From ?? 0, To: SourceText.length <= 24000 ? SourceText.length : Window?.To ?? Source.Text.length, Total: SourceText.length }, SourceBlocks: Included.filter(B => B.From >= (SourceText.length <= 24000 ? 0 : Window?.From ?? 0) && B.To <= (SourceText.length <= 24000 ? SourceText.length : Window?.To ?? Source.Text.length)).map(B => ({ Id: B.Id, Kind: B.Kind, From: B.From, To: B.To, Text: B.Text })), RootMessageId: Location.RootMessageId ?? MessageId, ...(Location.ParentMessageId ? { ParentMessageId: Location.ParentMessageId } : {}), ...(Location.SourcePath ? { SourcePath: Location.SourcePath } : {}), ...(Location.SourceReferences ? { SourceReferences: structuredClone(Location.SourceReferences) } : {}) };
}
