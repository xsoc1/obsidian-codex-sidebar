interface WindowState { FirstId: string; LastId?: string; Start: number; End?: number; Forced?: boolean; }
export class HistoryWindow
{
	private Windows = new Map<string, WindowState>();
	constructor(readonly Batch = 40, readonly Maximum = Batch * 3) { if(!Number.isInteger(Batch) || Batch < 1 || !Number.isInteger(Maximum) || Maximum < Batch) { throw Error("历史显示批量无效"); } }
	private start(Stored: WindowState | undefined, Messages: readonly { Id: string }[]): number
	{
		return Stored ? Messages[Stored.Start]?.Id === Stored.FirstId ? Stored.Start : Messages.findIndex(M => M.Id === Stored.FirstId) : -1;
	}
	select<T extends { Id: string }>(Context: string, Messages: readonly T[], Reusable: boolean): { Items: T[]; Earlier: number; Later: number; Signature: string }
	{
		const Stored = this.Windows.get(Context), Old = Reusable || Stored?.Forced ? Stored : undefined, Found = this.start(Old, Messages);
		let Start = Found >= 0 ? Found : Math.max(0, Messages.length - this.Batch);
		const Last = Old?.LastId ? Old.End !== undefined && Messages[Old.End - 1]?.Id === Old.LastId ? Old.End - 1 : Messages.findIndex(M => M.Id === Old.LastId) : -1;
		const End = Last >= Start ? Last + 1 : Messages.length;
		Start = Math.max(Start, End - this.Maximum);
		const State: WindowState = { FirstId: Messages[Start]?.Id ?? "", Start, ...(Old?.LastId && Last >= Start ? { LastId: Old.LastId, End } : {}) }; this.Windows.delete(Context); this.Windows.set(Context, State);
		while(this.Windows.size > 3) { this.Windows.delete(this.Windows.keys().next().value!); }
		return { Items: Messages.slice(Start, End), Earlier: Start, Later: Messages.length - End, Signature: JSON.stringify(State) };
	}
	older(Context: string, Messages: readonly { Id: string }[]): void
	{
		const Current = this.Windows.get(Context), Found = this.start(Current, Messages);
		const Start = Math.max(0, (Found >= 0 ? Found : Messages.length) - this.Batch);
		const End = Math.min(Current?.End ?? Messages.length, Start + this.Maximum);
		this.Windows.set(Context, { FirstId: Messages[Start]?.Id ?? "", Start, ...(End < Messages.length ? { LastId: Messages[End - 1]?.Id, End } : {}) });
	}
	newer(Context: string, Messages: readonly { Id: string }[]): void
	{
		const Current = this.Windows.get(Context), Found = this.start(Current, Messages);
		const Start = Math.min(Math.max(0, Messages.length - this.Batch), Math.max(0, Found) + this.Batch), End = Math.min(Messages.length, Start + this.Maximum);
		this.Windows.set(Context, { FirstId: Messages[Start]?.Id ?? "", Start, ...(End < Messages.length ? { LastId: Messages[End - 1]?.Id, End } : {}) });
	}
	focus(Context: string, Messages: readonly { Id: string }[], MessageId: string): boolean
	{
		const Index = Messages.findIndex(M => M.Id === MessageId); if(Index < 0) { return false; }
		const Start = Math.max(0, Index - Math.floor(this.Batch / 4)), End = Math.min(Messages.length - 1, Start + this.Batch - 1);
		this.Windows.set(Context, { FirstId: Messages[Start].Id, LastId: Messages[End].Id, Start, End: End + 1, Forced: true }); return true;
	}
	latest(Context: string): void { this.Windows.delete(Context); }
	key(Context: string): string { return JSON.stringify(this.Windows.get(Context) ?? null); }
	forget(Context: string): void { this.Windows.delete(Context); }
	clear(): void { this.Windows.clear(); }
}
