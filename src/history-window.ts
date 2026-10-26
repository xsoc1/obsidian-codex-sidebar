interface WindowState { FirstId: string; LastId?: string; Forced?: boolean; }
export class HistoryWindow
{
	private Windows = new Map<string, WindowState>();
	constructor(readonly Batch = 40) { if(!Number.isInteger(Batch) || Batch < 1) { throw Error("历史显示批量无效"); } }
	select<T extends { Id: string }>(Context: string, Messages: readonly T[], Reusable: boolean): { Items: T[]; Earlier: number; Later: number; Signature: string }
	{
		const Stored = this.Windows.get(Context), Old = Reusable || Stored?.Forced ? Stored : undefined, Found = Old ? Messages.findIndex(M => M.Id === Old.FirstId) : -1;
		const Start = Found >= 0 ? Found : Math.max(0, Messages.length - this.Batch);
		const Last = Old?.LastId ? Messages.findIndex(M => M.Id === Old.LastId) : -1, End = Last >= Start ? Last + 1 : Messages.length;
		const State = { FirstId: Messages[Start]?.Id ?? "", ...(Old?.LastId && Last >= Start ? { LastId: Old.LastId } : {}) }; this.Windows.delete(Context); this.Windows.set(Context, State);
		while(this.Windows.size > 3) { this.Windows.delete(this.Windows.keys().next().value!); }
		return { Items: Messages.slice(Start, End), Earlier: Start, Later: Messages.length - End, Signature: JSON.stringify(State) };
	}
	older(Context: string, Messages: readonly { Id: string }[]): void
	{
		const Current = this.Windows.get(Context), Found = Current ? Messages.findIndex(M => M.Id === Current.FirstId) : -1;
		const Start = Math.max(0, (Found >= 0 ? Found : Messages.length) - this.Batch);
		this.Windows.set(Context, { ...Current, FirstId: Messages[Start]?.Id ?? "" });
	}
	focus(Context: string, Messages: readonly { Id: string }[], MessageId: string): boolean
	{
		const Index = Messages.findIndex(M => M.Id === MessageId); if(Index < 0) { return false; }
		const Start = Math.max(0, Index - Math.floor(this.Batch / 4)), End = Math.min(Messages.length - 1, Start + this.Batch - 1);
		this.Windows.set(Context, { FirstId: Messages[Start].Id, LastId: Messages[End].Id, Forced: true }); return true;
	}
	latest(Context: string): void { this.Windows.delete(Context); }
	key(Context: string): string { return JSON.stringify(this.Windows.get(Context) ?? null); }
	forget(Context: string): void { this.Windows.delete(Context); }
	clear(): void { this.Windows.clear(); }
}
