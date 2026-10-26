export type RuntimeStage = "offline" | "connecting" | "idle" | "preparing" | "submission-unknown" | "generating" | "stopping" | "recovering";
export interface PreparationTicket
{
	Generation: number;
	Scope: string;
	SessionId: string;
	OperationId?: string;
	Submitted?: boolean;
	Controller: AbortController;
}
export class PreparationCancelled extends Error
{
	constructor() { super("准备已取消, 未自动重发; 已保存问题与来源保留"); this.name = "AbortError"; }
}
export class RunLifecycle
{
	Stage: RuntimeStage = "offline";
	private Generation = 0;
	private Ticket: PreparationTicket | null = null;
	get Active(): PreparationTicket | null { return this.Ticket; }
	get CanStop(): boolean { return ["connecting", "preparing", "submission-unknown", "generating", "stopping", "recovering"].includes(this.Stage); }
	get BlocksInput(): boolean { return this.CanStop; }
	begin(Scope: string, SessionId: string): PreparationTicket
	{
		this.Ticket?.Controller.abort();
		this.Ticket = { Generation: ++this.Generation, Scope, SessionId, Controller: new AbortController() }; this.Stage = "preparing"; return this.Ticket;
	}
	current(Ticket: PreparationTicket): boolean { return this.Ticket === Ticket && Ticket.Generation === this.Generation && !Ticket.Controller.signal.aborted; }
	check(Ticket: PreparationTicket): void { if(!this.current(Ticket)) { throw new PreparationCancelled(); } }
	stage(Stage: RuntimeStage, Ticket?: PreparationTicket): void { if(!Ticket || this.current(Ticket)) { this.Stage = Stage; } }
	cancel_preparation(): PreparationTicket | null
	{
		if(!["connecting", "preparing", "recovering"].includes(this.Stage) || this.Ticket?.Submitted) { return null; }
		const Ticket = this.Ticket; Ticket?.Controller.abort(); this.Generation++; this.Ticket = null; this.Stage = "idle"; return Ticket;
	}
	finish(Ticket?: PreparationTicket): void
	{
		if(Ticket && this.Ticket !== Ticket) { return; }
		this.Ticket = null; this.Stage = "idle";
	}
	close(): void { this.Ticket?.Controller.abort(); this.Generation++; this.Ticket = null; this.Stage = "offline"; }
}
export async function preparation_step<T>(Work: Promise<T>, Ticket: PreparationTicket, Runtime: RunLifecycle): Promise<T>
{
	Runtime.check(Ticket);
	let Abort!: () => void;
	const Cancel = new Promise<never>((_Resolve, Reject) => { Abort = () => Reject(new PreparationCancelled()); Ticket.Controller.signal.addEventListener("abort", Abort, { once: true }); });
	try { const Value = await Promise.race([Work, Cancel]); Runtime.check(Ticket); return Value; }
	finally { Ticket.Controller.signal.removeEventListener("abort", Abort); }
}
