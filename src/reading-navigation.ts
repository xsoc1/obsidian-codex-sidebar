export interface ReadingBlock
{
	Id: string;
	From: number;
	To: number;
	TextVersion: string;
}
export interface ReadingPosition
{
	Scope: string;
	SessionId: string;
	MessageId: string;
	Label: string;
	Offset: number;
	Block?: ReadingBlock;
}
export interface ReadingTicket { Context: string; Generation: number; Origin?: ReadingPosition; }
/** View-local, bounded navigation. A user interaction invalidates in-flight work. */
export class ReadingNavigation
{
	private Context = "";
	private Generation = 0;
	private Trails = new Map<string, ReadingPosition[]>();
	constructor(readonly Maximum = 12, readonly ContextMaximum = 3) {}
	enter(Context: string): void
	{
		if(Context !== this.Context) { this.Context = Context; this.cancel(); }
	}
	cancel(): void { this.Generation++; }
	begin(Context: string, Origin?: ReadingPosition): ReadingTicket
	{
		this.enter(Context); this.cancel();
		return { Context, Generation: this.Generation, ...(Origin ? { Origin } : {}) };
	}
	current(Ticket: ReadingTicket, Context: string): boolean { return this.Context === Context && Ticket.Context === Context && Ticket.Generation === this.Generation; }
	target(Context: string): ReadingPosition | undefined { return this.Trails.get(Context)?.at(-1); }
	discard(Context: string): void { const Trail = [...(this.Trails.get(Context) ?? [])]; Trail.pop(); this.store(Context, Trail); }
	commit(Ticket: ReadingTicket): void
	{
		if(!this.current(Ticket, this.Context) || !Ticket.Origin) { return; }
		const Trail = this.Trails.get(Ticket.Context) ?? [];
		Trail.push(Ticket.Origin); this.store(Ticket.Context, Trail.slice(-this.Maximum));
	}
	exchange(Ticket: ReadingTicket): void
	{
		if(!this.current(Ticket, this.Context)) { return; }
		const Trail = [...(this.Trails.get(Ticket.Context) ?? [])]; Trail.pop();
		if(Ticket.Origin) { Trail.push(Ticket.Origin); }
		this.store(Ticket.Context, Trail);
	}
	private store(Context: string, Trail: ReadingPosition[]): void
	{
		this.Trails.delete(Context); if(Trail.length) { this.Trails.set(Context, Trail); }
		while(this.Trails.size > this.ContextMaximum) { this.Trails.delete(this.Trails.keys().next().value!); }
	}
	forget(Context: string): void { this.Trails.delete(Context); if(this.Context === Context) { this.cancel(); } }
	clear(): void { this.cancel(); this.Trails.clear(); }
}
