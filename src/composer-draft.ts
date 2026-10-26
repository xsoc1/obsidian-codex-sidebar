import type { ContextSnapshot, AnswerQuote } from "./prompt";
import { source_path } from "./edit/document";

export interface ComposerMaterial { Context: ContextSnapshot | null; Quote: AnswerQuote | null; }
export interface ComposerDraft extends ComposerMaterial { schemaVersion: 1; Scope: string; SessionId: string; Revision: number; Text: string; }
interface StorageLike { getItem(Key: string): string | null; setItem(Key: string, Value: string): void; }
export class ComposerDraftStore
{
	readonly Key: string;
	constructor(private Storage: StorageLike, readonly Scope: string, readonly SessionId: string)
	{
		if(!Scope || Scope.length > 2048 || !SessionId || SessionId.length > 128) { throw Error("草稿作用域无效"); }
		this.Key = `codex-sidebar-composer:v1:${encodeURIComponent(Scope)}:${encodeURIComponent(SessionId)}`;
	}
	load(): ComposerDraft | null
	{
		const Raw = this.Storage.getItem(this.Key); if(!Raw) { return null; }
		const D = JSON.parse(Raw) as ComposerDraft;
		this.validate(D);
		return structuredClone(D);
	}
	private validate(D: ComposerDraft): void
	{
		if(!D || D.schemaVersion !== 1 || D.Scope !== this.Scope || D.SessionId !== this.SessionId || !Number.isSafeInteger(D.Revision) || D.Revision < 1 || typeof D.Text !== "string" || !("Context" in D) || !("Quote" in D)) { throw Error("草稿记录损坏或作用域不匹配, 原数据保留"); }
		if(D.Context) { if(typeof D.Context.Path !== "string" || typeof D.Context.Text !== "string" || typeof D.Context.SelectedText !== "string" || typeof D.Context.CapturedAt !== "string") { throw Error("草稿来源快照损坏"); } source_path(D.Context.Path); }
		if(D.Quote && (D.Quote.SessionId !== this.SessionId || typeof D.Quote.MessageId !== "string" || typeof D.Quote.SelectedText !== "string" || typeof D.Quote.SourceText !== "string")) { throw Error("草稿引用不属于原会话或已损坏"); }
		if(D.Quote?.SourcePath) { source_path(D.Quote.SourcePath); }
	}
	save(Text: string, Material: ComposerMaterial, Expected: number): ComposerDraft | null
	{
		const Current = this.load(), Revision = Current?.Revision ?? 0;
		const Value = { Text, Context: Text || Material.Quote ? Material.Context : null, Quote: Material.Quote };
		if(Current && JSON.stringify({ Text: Current.Text, Context: Current.Context, Quote: Current.Quote }) === JSON.stringify(Value)) { return Current; }
		if(Revision !== Expected) { throw Error("另一窗口已更新此会话草稿, 未覆盖双方内容; 请复制当前输入后核对"); }
		if(!Current && !Text && !Material.Quote) { return null; }
		const Next: ComposerDraft = { schemaVersion: 1, Scope: this.Scope, SessionId: this.SessionId, Revision: Revision + 1, ...structuredClone(Value) }, Raw = JSON.stringify(Next);
		this.validate(Next);
		if(new TextEncoder().encode(Raw).byteLength > 512 * 1024) { throw Error("草稿超过本设备保存预算, 请先复制输入并缩小来源; 当前输入未清除"); }
		this.Storage.setItem(this.Key, Raw); if(this.Storage.getItem(this.Key) !== Raw) { throw Error("草稿保存回读不一致, 当前输入保留"); }
		return Next;
	}
}
