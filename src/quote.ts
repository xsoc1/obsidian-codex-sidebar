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
const DisplayMath = 'mjx-container[display="true"],.math-block,.math-display';
function compatible(Node: Element, Block: MarkdownBlock): boolean
{
	if(Block.Kind === "separator") { return Node.tagName === "HR"; }
	if(Block.Kind === "footnote") { return false; }
	if(Block.Kind === "math") { return !!Node.querySelector(DisplayMath) || Node.matches(DisplayMath); }
	if(Block.Kind === "code") { return Node.tagName === "PRE"; }
	if(Block.Kind === "heading") { return /^H[1-6]$/.test(Node.tagName) && plain(Block.Text.replace(/^\s*#{1,6}\s/, "")) === plain(Node.textContent ?? ""); }
	if(Block.Kind === "list") { return ["UL", "OL"].includes(Node.tagName); }
	if(Block.Kind === "table") { return Node.tagName === "TABLE" || !!Node.querySelector("table"); }
	if(Block.Kind === "callout") { return Node.tagName === "BLOCKQUOTE" || Node.classList.contains("callout"); }
	if(Node.tagName !== "P") { return false; }
	if(plain(Block.Text) === plain(Node.textContent ?? "")) { return true; }
	return !!Node.querySelector("mjx-container,.math-inline") && Block.Text.includes("$");
}
function source_match_key(Block: MarkdownBlock): string
{
	if(Block.Kind === "heading") { return "heading:" + plain(Block.Text.replace(/^\s*#{1,6}\s/, "")); }
	if(Block.Kind === "paragraph") { return Block.Text.includes("$") ? "paragraph-math" : "paragraph:" + plain(Block.Text); }
	return Block.Kind;
}
function node_match_keys(Node: Element): string[]
{
	if(/^H[1-6]$/.test(Node.tagName)) { return ["heading:" + plain(Node.textContent ?? "")]; }
	if(Node.tagName === "P") { return ["paragraph:" + plain(Node.textContent ?? ""), ...(Node.querySelector("mjx-container,.math-inline") ? ["paragraph-math"] : []), ...(Node.querySelector(DisplayMath) ? ["math"] : [])]; }
	if(Node.tagName === "HR") { return ["separator"]; }
	if(Node.tagName === "PRE") { return ["code"]; }
	if(["UL", "OL"].includes(Node.tagName)) { return ["list"]; }
	if(Node.tagName === "TABLE") { return ["table"]; }
	if(Node.tagName === "BLOCKQUOTE" || Node.classList.contains("callout")) { return ["callout"]; }
	return [...(Node.querySelector("table") ? ["table"] : []), ...(Node.querySelector(DisplayMath) || Node.matches(DisplayMath) ? ["math"] : [])];
}

export function bind_answer_blocks(Root: HTMLElement, Markdown: string, MessageKey?: string): boolean
{
	const Blocks = markdown_blocks(Markdown), Nodes = [...Root.children].filter(N => !N.matches(".copy-code-button,.mod-footer"));
	Root.dataset.codexAnswerVersion = text_identity(Markdown);
	if(MessageKey !== undefined) { Root.dataset.codexAnswerMessage = MessageKey; } else { delete Root.dataset.codexAnswerMessage; }
	for(const N of Root.querySelectorAll<HTMLElement>("[data-codex-answer-block]")) { delete N.dataset.codexAnswerBlock; delete N.dataset.codexAnswerFrom; delete N.dataset.codexAnswerTo; }
	const Assigned = new Map<number, number>(), Used = new Set<number>();
	const Bind = (N: number, B: number) => { if(!Assigned.has(N) && !Used.has(B)) { Assigned.set(N, B); Used.add(B); } };
	const MathCounts = new Map<string, number>();
	for(const B of Blocks) { if(B.Kind === "math") { MathCounts.set(B.Text, (MathCounts.get(B.Text) ?? 0) + 1); } }
	const RepeatedMath = new Set(Blocks.filter(B => B.Kind === "math" && MathCounts.get(B.Text)! > 1).map(B => B.Id));
	// Renderer source positions are line metadata, never DOM character offsets.
	Nodes.forEach((N, I) =>
	{
		const Position = N.getAttribute?.("data-sourcepos")?.match(/^(\d+):\d+-(\d+):\d+$/);
		if(!Position) { return; }
		const Candidates = Blocks.flatMap((B, J) => B.LineStart === Number(Position[1]) - 1 && B.LineEnd === Number(Position[2]) - 1 && compatible(N, B) ? [J] : []);
		if(Candidates.length === 1) { Bind(I, Candidates[0]); }
	});
	if(Nodes.length === Blocks.length && Nodes.every((N, I) => compatible(N, Blocks[I])))
	{
		Nodes.forEach((_N, I) => { if(!RepeatedMath.has(Blocks[I].Id)) { Bind(I, I); } });
	}
	else
	{
		// Unique local anchors survive unknown footers/widgets/footnotes. Structural
		// matches are safe only when both the source and rendered candidate are unique.
		const SourceCandidates = new Map<string, number[]>(), NodeCandidates = new Map<string, number[]>();
		Blocks.forEach((B, I) => { const Key = source_match_key(B); SourceCandidates.set(Key, [...(SourceCandidates.get(Key) ?? []), I]); });
		Nodes.forEach((N, I) => { for(const Key of node_match_keys(N)) { NodeCandidates.set(Key, [...(NodeCandidates.get(Key) ?? []), I]); } });
		Nodes.forEach((N, I) =>
		{
			const Candidates = [...new Set(node_match_keys(N).flatMap(Key => SourceCandidates.get(Key) ?? []))].filter(J => !Used.has(J) && !RepeatedMath.has(Blocks[J].Id) && compatible(N, Blocks[J]));
			if(Candidates.length !== 1) { return; }
			const B = Candidates[0], Reverse = (NodeCandidates.get(source_match_key(Blocks[B])) ?? []).filter(J => !Assigned.has(J) && compatible(Nodes[J], Blocks[B]));
			if(Reverse.length === 1) { Bind(I, B); }
		});
	}
	for(const [N, B] of Assigned)
	{
		const ElementValue = Nodes[N] as HTMLElement, Block = Blocks[B];
		ElementValue.dataset.codexAnswerBlock = Block.Id; ElementValue.dataset.codexAnswerFrom = String(Block.From); ElementValue.dataset.codexAnswerTo = String(Block.To);
	}
	return Assigned.size > 0;
}

export function quote_blocks(Root: HTMLElement, Range: Range, Markdown: string, MessageKey?: string): QuoteLocation
{
	if(!Root.contains(Range.commonAncestorContainer) || Root.dataset.codexAnswerVersion !== text_identity(Markdown)) { return { Mapping: "unknown" }; }
	if(MessageKey !== undefined && Root.dataset.codexAnswerMessage !== MessageKey) { return { Mapping: "unknown" }; }
	if([...Root.children].some(N => Range.intersectsNode(N) && !(N as HTMLElement).dataset.codexAnswerBlock && !N.matches(".copy-code-button,.mod-footer"))) { return { Mapping: "unknown" }; }
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
	if(!Range && Location.Mapping !== "unknown" && SelectedText.trim())
	{
		const From = SourceText.indexOf(SelectedText.trim());
		if(From >= 0 && SourceText.indexOf(SelectedText.trim(), From + 1) < 0) { Range = { From, To: From + SelectedText.trim().length }; Mapping = "source-blocks"; }
	}
	const Window = Range ? context_window(SourceText, Range.From, Range.To) : null;
	const Source = SourceText.length <= 24000 ? { Text: SourceText, Truncated: false } : Window ? { Text: Window.Text, Truncated: true } : { Text: "", Truncated: true };
	const Included = markdown_blocks(SourceText).filter(B => B.To > (Window?.From ?? 0) && B.From < (Window?.To ?? Source.Text.length));
	return { SessionId, MessageId, SelectedText: Selected.Text, SourceText: Source.Text, SelectedTruncated: Selected.Truncated, SourceTruncated: Source.Truncated, FollowupMode: "integrated-v1", SourceStatus, SourceVersion: text_identity(SourceText), Mapping: SourceText.length <= 24000 && !Range ? "full-answer" : Mapping, SourceRange: { From: SourceText.length <= 24000 ? 0 : Window?.From ?? 0, To: SourceText.length <= 24000 ? SourceText.length : Window?.To ?? Source.Text.length, Total: SourceText.length }, SourceBlocks: Included.filter(B => B.From >= (SourceText.length <= 24000 ? 0 : Window?.From ?? 0) && B.To <= (SourceText.length <= 24000 ? SourceText.length : Window?.To ?? Source.Text.length)).map(B => ({ Id: B.Id, Kind: B.Kind, From: B.From, To: B.To, Text: B.Text })), RootMessageId: Location.RootMessageId ?? MessageId, ...(Location.ParentMessageId ? { ParentMessageId: Location.ParentMessageId } : {}), ...(Location.SourcePath ? { SourcePath: Location.SourcePath } : {}), ...(Location.SourceReferences ? { SourceReferences: structuredClone(Location.SourceReferences) } : {}) };
}
