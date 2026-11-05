import { markdown_blocks, text_identity } from "./markdown-blocks";

export interface SelectedAnswerBlocks
{
	SessionId: string;
	MessageId: string;
	SourceVersion: string;
	From: number;
	To: number;
	BlockIds: string[];
}

export function inherited_quote_session(Current: { Id: string; ParentId?: string }, Sessions: readonly { Id: string; ParentId?: string }[], OriginalSession: string): boolean
{
	if(Current.Id === OriginalSession) { return true; }
	const Seen = new Set([Current.Id]); let Id = Current.ParentId;
	while(Id && !Seen.has(Id))
	{
		if(Id === OriginalSession) { return true; }
		Seen.add(Id); Id = Sessions.find(S => S.Id === Id)?.ParentId;
	}
	return false;
}

export function selected_answer_blocks(SessionId: string, MessageId: string, Text: string, Range: { From: number; To: number } | undefined, BlockIds: string[] | undefined): SelectedAnswerBlocks | undefined
{
	if(!Range || !BlockIds?.length) { return undefined; }
	const Value = { SessionId, MessageId, SourceVersion: text_identity(Text), ...Range, BlockIds: [...BlockIds] };
	return verify_answer_blocks(Value, SessionId, MessageId, Text) ? Value : undefined;
}

export function verify_answer_blocks(Value: SelectedAnswerBlocks | undefined, SessionId: string, MessageId: string, Text: string): boolean
{
	if(!Value || Value.SessionId !== SessionId || Value.MessageId !== MessageId || Value.SourceVersion !== text_identity(Text) || !Number.isSafeInteger(Value.From) || !Number.isSafeInteger(Value.To) || Value.From < 0 || Value.To <= Value.From || Value.To > Text.length || !Array.isArray(Value.BlockIds) || !Value.BlockIds.length || new Set(Value.BlockIds).size !== Value.BlockIds.length) { return false; }
	const Blocks = markdown_blocks(Text).filter(B => B.To > Value.From && B.From < Value.To);
	return Blocks.length === Value.BlockIds.length && Blocks[0].From === Value.From && Blocks.at(-1)!.To === Value.To && Blocks.every((B, I) => B.Id === Value.BlockIds[I]);
}

export function locate_answer_blocks(Root: HTMLElement, Value: SelectedAnswerBlocks | undefined, SessionId: string, MessageId: string, Text: string, MessageKey: string): HTMLElement[]
{
	if(!verify_answer_blocks(Value, SessionId, MessageId, Text) || Root.dataset.codexAnswerVersion !== Value!.SourceVersion || Root.dataset.codexAnswerMessage !== MessageKey) { return []; }
	const Nodes = [...Root.querySelectorAll<HTMLElement>("[data-codex-answer-block]")], Blocks = new Map(markdown_blocks(Text).map(B => [B.Id, B]));
	const Selected: HTMLElement[] = [];
	for(const Id of Value!.BlockIds)
	{
		const Matches = Nodes.filter(N => N.dataset.codexAnswerBlock === Id), Block = Blocks.get(Id)!;
		if(Matches.length !== 1 || Number(Matches[0].dataset.codexAnswerFrom) !== Block.From || Number(Matches[0].dataset.codexAnswerTo) !== Block.To) { return []; }
		Selected.push(Matches[0]);
	}
	return Selected;
}
