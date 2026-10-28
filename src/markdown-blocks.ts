export interface MarkdownBlock
{
	Id: string;
	Kind: "heading" | "paragraph" | "math" | "code" | "list" | "table" | "callout" | "separator" | "footnote";
	From: number;
	To: number;
	LineStart: number;
	LineEnd: number;
	Closed: boolean;
	Text: string;
}

export function text_identity(Text: string): string
{
	let A = 2166136261, B = 2246822519;
	for(let I = 0; I < Text.length; I++) { A = Math.imul(A ^ Text.charCodeAt(I), 16777619); B = Math.imul(B ^ Text.charCodeAt(I), 3266489917); }
	return (A >>> 0).toString(16).padStart(8, "0") + (B >>> 0).toString(16).padStart(8, "0");
}
function body_line(Line: string): string { return Line.replace(/^\s*(?:>\s*)+/, ""); }
function math_state(Line: string, Stack: string[]): void
{
	const Clean = Line.replace(/`[^`]*`/g, "");
	const Tokens = Clean.match(/(?<!\\)\$\$|\\\[|\\\]|\\(?:begin|end)\{(?:equation\*?|align\*?|aligned|gather\*?|gathered|multline\*?|cases|split)\}/g) ?? [];
	for(const Token of Tokens)
	{
		if(Token === "$$") { if(Stack.at(-1) === "$$") { Stack.pop(); } else { Stack.push("$$"); } }
		else if(Token === "\\[") { Stack.push("\\["); }
		else if(Token === "\\]") { if(Stack.at(-1) === "\\[") { Stack.pop(); } }
		else
		{
			const Name = Token.slice(Token.indexOf("{") + 1, -1);
			if(Token.startsWith("\\begin")) { Stack.push(Name); } else if(Stack.at(-1) === Name) { Stack.pop(); }
		}
	}
}
function math_open(Line: string): boolean { return /(?<!\\)\$\$|\\\[|\\begin\{(?:equation\*?|align\*?|aligned|gather\*?|gathered|multline\*?|cases|split)\}/.test(Line); }
function list_line(Line: string): boolean { return /^\s*(?:[-+*]|\d+[.)])\s+/.test(Line); }
function table_line(Line: string): boolean { return /^\s*\|.*\|\s*$/.test(Line) || /\|/.test(Line) && /^\s*\|?\s*:?-{3,}/.test(Line); }
function table_start(Lines: string[], Index: number): boolean { return table_line(Lines[Index]) || Lines[Index].includes("|") && /^\s*\|?\s*:?-{3,}/.test(Lines[Index + 1] ?? ""); }
function separator(Line: string): boolean { return /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(Line); }

export function markdown_blocks(Source: string): MarkdownBlock[]
{
	const Lines = Source.split("\n"), Offsets = [0];
	for(let I = 0; I < Lines.length; I++) { Offsets.push(Offsets[I] + Lines[I].length + (I + 1 < Lines.length ? 1 : 0)); }
	const Blocks: MarkdownBlock[] = [];
	for(let I = 0; I < Lines.length;)
	{
		if(!Lines[I].trim()) { I++; continue; }
		const Start = I, First = body_line(Lines[I]), Fence = First.match(/^\s*(`{3,}|~{3,})/), Stack: string[] = [];
		let Kind: MarkdownBlock["Kind"] = "paragraph", Closed = true;
		if(Fence)
		{
			Kind = "code"; Closed = false; I++;
			for(; I < Lines.length; I++) { const End = body_line(Lines[I]).match(/^\s*(`{3,}|~{3,})\s*$/); if(End && End[1][0] === Fence[1][0] && End[1].length >= Fence[1].length) { I++; Closed = true; break; } }
		}
		else if(/^\s*>/.test(Lines[I]))
		{
			Kind = "callout";
			let InnerFence = "";
			for(; I < Lines.length && (/^\s*>/.test(Lines[I]) || Stack.length > 0); I++)
			{
				const L = body_line(Lines[I]), Marker = L.match(/^\s*(`{3,}|~{3,})/);
				if(Marker) { if(!InnerFence) { InnerFence = Marker[1]; } else if(Marker[1][0] === InnerFence[0] && Marker[1].length >= InnerFence.length) { InnerFence = ""; } continue; }
				if(!InnerFence) { math_state(L, Stack); }
			}
			Closed = Stack.length === 0 && !InnerFence;
		}
		else if(separator(First)) { Kind = "separator"; I++; }
		else if(/^\s*\[\^[^\]]+\]:/.test(First)) { Kind = "footnote"; I++; while(I < Lines.length && /^\s{2,}\S/.test(Lines[I])) { I++; } }
		else if(math_open(First) && !list_line(First))
		{
			Kind = "math"; math_state(First, Stack); I++;
			for(; I < Lines.length && Stack.length; I++) { math_state(Lines[I], Stack); }
			Closed = Stack.length === 0;
		}
		else if(/^\s*#{1,6}\s/.test(First)) { Kind = "heading"; I++; }
		else if(list_line(First))
		{
			Kind = "list"; let InnerFence = "";
			for(; I < Lines.length; I++)
			{
				const L = Lines[I];
				if(!L.trim()) { if(Stack.length || InnerFence || I + 1 < Lines.length && (list_line(Lines[I + 1]) || /^\s{2,}\S/.test(Lines[I + 1]))) { continue; } break; }
				if(!Stack.length && !InnerFence && !list_line(L) && !/^\s{2,}\S/.test(L)) { break; }
				const Inner = L.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, ""), Marker = Inner.match(/^\s*(`{3,}|~{3,})/);
				if(Marker) { if(!InnerFence) { InnerFence = Marker[1]; } else if(Marker[1][0] === InnerFence[0] && Marker[1].length >= InnerFence.length) { InnerFence = ""; } }
				else if(!InnerFence) { math_state(Inner, Stack); }
			}
			Closed = Stack.length === 0 && !InnerFence;
		}
		else if(table_start(Lines, I)) { Kind = "table"; I++; while(I < Lines.length && Lines[I].includes("|") && Lines[I].trim()) { I++; } }
		else
		{
			I++;
			while(I < Lines.length && Lines[I].trim() && !/^\s*(?:#{1,6}\s|>|`{3,}|~{3,}|\[\^[^\]]+\]:)/.test(Lines[I]) && !separator(Lines[I]) && !math_open(Lines[I]) && !list_line(Lines[I]) && !table_start(Lines, I)) { I++; }
		}
		const EndLine = Math.max(Start, I - 1), From = Offsets[Start], To = Offsets[EndLine] + Lines[EndLine].length, Text = Source.slice(From, To);
		Blocks.push({ Id: `block-${Blocks.length}-${text_identity(Text)}`, Kind, From, To, LineStart: Start, LineEnd: EndLine, Closed, Text });
	}
	return Blocks;
}

export interface ContextWindow
{
	Text: string;
	From: number;
	To: number;
	LineStart: number;
	LineEnd: number;
	Truncated: boolean;
	Closed: boolean;
	Blocks: { Id: string; Kind: MarkdownBlock["Kind"]; From: number; To: number }[];
	Missing: { From: number; To: number }[];
}

export function context_window(Source: string, From: number, To: number, Budget = 24000): ContextWindow
{
	if(!Number.isSafeInteger(From) || !Number.isSafeInteger(To) || From < 0 || To < From || To > Source.length || Budget < 1) { throw new Error("上下文位置或预算无效"); }
	const Blocks = markdown_blocks(Source), Selected = Blocks.filter(B => B.To >= From && B.From <= To);
	const Focus = Selected.length ? Selected : Blocks.filter(B => B.From <= From).slice(-1);
	let A = Focus[0]?.From ?? From, B = Focus.at(-1)?.To ?? To;
	let NeededA = A; const NeededB = B;
	const Section = Blocks.filter(Block => Block.Kind === "heading" && Block.From <= A).at(-1)?.From ?? 0;
	const Claim = Blocks.filter(Block => Block.Kind === "callout" && Block.From >= Section && Block.To <= A && /\[!(?:theorem|lemma|proposition|definition|note|important|question)\]/i.test(Block.Text)).at(-1);
	if(Claim) { NeededA = Claim.From; if(B - NeededA <= Budget) { A = NeededA; } }
	let First = Blocks.findIndex(Block => Block.From === A), Last = Blocks.findIndex(Block => Block.To === B);
	if(B - A <= Budget)
	{
		if(First > 0 && B - Blocks[First - 1].From <= Budget) { A = Blocks[--First].From; }
		if(Last >= 0 && Last + 1 < Blocks.length && Blocks[Last + 1].Kind !== "heading" && Blocks[Last + 1].To - A <= Budget) { B = Blocks[++Last].To; }
	}
	if(B - A > Budget)
	{
		const Span = To - From;
		A = Math.max(NeededA, Math.min(From - Math.floor(Math.max(0, Budget - Span) / 2), NeededB - Budget));
		B = Math.min(Source.length, A + Budget);
	}
	const Included = Blocks.filter(Block => Block.To > A && Block.From < B), Missing: { From: number; To: number }[] = [];
	if(A > NeededA) { Missing.push({ From: NeededA, To: A }); }
	if(B < NeededB) { Missing.push({ From: B, To: NeededB }); }
	return { Text: Source.slice(A, B), From: A, To: B, LineStart: Source.slice(0, A).split("\n").length - 1, LineEnd: Source.slice(0, B).split("\n").length - 1, Truncated: Missing.length > 0 || Included.some(Block => !Block.Closed), Closed: Included.every(Block => Block.Closed && Block.From >= A && Block.To <= B), Blocks: Included.map(({ Id, Kind, From: Start, To: End }) => ({ Id, Kind, From: Start, To: End })), Missing };
}
