interface Span { From: number; To: number; Complete: boolean; }

function formula_spans(Text: string): Span[]
{
	const Spans: Span[] = []; let Position = 0, Math = -1, Code: { Mark: string; From: number } | null = null;
	for(const Line of Text.split("\n"))
	{
		const Fence = Line.match(/^ {0,3}(`{3,}|~{3,})/);
		if(Code)
		{
			if(Fence && Fence[1][0] === Code.Mark[0] && Fence[1].length >= Code.Mark.length) { Spans.push({ From: Code.From, To: Position + Line.length, Complete: true }); Code = null; }
		}
		else if(Fence && Math < 0) { Code = { Mark: Fence[1], From: Position }; }
		else
		{
			for(const Match of Line.matchAll(/\\.|(\$\$)/g))
			{
				if(!Match[1]) { continue; }
				if(Math < 0) { Math = Position + Match.index!; }
				else { Spans.push({ From: Math, To: Position + Match.index! + 2, Complete: true }); Math = -1; }
			}
		}
		Position += Line.length + 1;
	}
	if(Math >= 0) { Spans.push({ From: Math, To: Text.length, Complete: false }); }
	if(Code) { Spans.push({ From: Code.From, To: Text.length, Complete: false }); }
	return Spans;
}

export function comparison_texts(Before: string | null, After: string, Range?: { From: number; To: number }): { Before: string; After: string; Expanded: boolean; RawOnly: boolean }
{
	const Original = Before ?? "";
	let From = Range?.From ?? 0, To = Range?.To ?? Original.length;
	if(!Range)
	{
		while(From < Original.length && From < After.length && Original[From] === After[From]) { From++; }
		let Tail = 0;
		while(Tail < Original.length - From && Tail < After.length - From && Original[Original.length - Tail - 1] === After[After.length - Tail - 1]) { Tail++; }
		To = Original.length - Tail;
	}
	if(From < 0 || To < From || To > Original.length || After.slice(0, From) !== Original.slice(0, From) || After.slice(After.length - (Original.length - To)) !== Original.slice(To)) { throw new Error("对照范围与实际改稿不一致"); }
	const Delta = After.length - Original.length;
	let Start = From, End = To;
	if(Start > 0 && Original.slice(Math.max(0, Start - 2), Start) !== "\n\n") { const Previous = Original.lastIndexOf("\n\n", Start - 1); Start = Previous < 0 ? 0 : Previous + 2; }
	if(End < Original.length && Original.slice(End, End + 2) !== "\n\n") { const Next = Original.indexOf("\n\n", End); End = Next < 0 ? Original.length : Next; }
	const Spans = formula_spans(Original); let Complete = true;
	for(let Index = Spans.length - 1; Index >= 0; Index--)
	{
		const Span = Spans[Index];
		if(Span.From < Start && Span.To > Start) { Start = Original.lastIndexOf("\n", Span.From - 1) + 1; }
	}
	for(const Span of Spans)
	{
		if(Span.From < End && Span.To > End) { const Next = Original.indexOf("\n", Span.To); End = Next < 0 ? Original.length : Next; }
		if(Span.From < End && Span.To > Start && !Span.Complete) { Complete = false; }
	}
	if(!Complete || End - Start > 80000 || End + Delta - Start > 80000)
	{
		return { Before: Original.slice(From, To), After: After.slice(From, To + Delta), Expanded: false, RawOnly: true };
	}
	const Proposed = After.slice(Start, End + Delta);
	return { Before: Original.slice(Start, End), After: Proposed, Expanded: Start !== From || End !== To, RawOnly: formula_spans(Proposed).some(Span => !Span.Complete) };
}
