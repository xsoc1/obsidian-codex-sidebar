// Only replaceable stream bodies use this lane. Durable operation barriers use enqueue without a key.
interface Job
{
	Key?: string;
	Work: () => Promise<void>;
	Promise: Promise<void>;
	Resolve(): void;
	Reject(ErrorValue: unknown): void;
}
export class SnapshotQueue
{
	private Pending: Job[] = [];
	private Running = false;
	readonly Stats = { submitted: 0, coalesced: 0, completed: 0, failed: 0, peakPending: 0 };
	get pending(): number { return this.Pending.length + Number(this.Running); }
	enqueue(Work: () => Promise<void>, Key?: string): Promise<void>
	{
		this.Stats.submitted++;
		let Index = this.Pending.length - 1;
		while(Key && Index >= 0 && this.Pending[Index].Key && this.Pending[Index].Key !== Key) { Index--; }
		const Prior = this.Pending[Index];
		if(Key && Prior?.Key === Key)
		{
			Prior.Work = Work; this.Pending.splice(Index, 1); this.Pending.push(Prior);
			this.Stats.coalesced++; return Prior.Promise;
		}
		let Resolve!: () => void, Reject!: (E: unknown) => void;
		const PromiseValue = new Promise<void>((resolve, reject) => { Resolve = resolve; Reject = reject; });
		this.Pending.push({ Key, Work, Promise: PromiseValue, Resolve, Reject });
		this.Stats.peakPending = Math.max(this.Stats.peakPending, this.Pending.length);
		void this.drain(); return PromiseValue;
	}
	private async drain(): Promise<void>
	{
		if(this.Running) { return; } this.Running = true;
		try
		{
			while(this.Pending.length)
			{
				const Job = this.Pending.shift()!;
				try { await Job.Work(); this.Stats.completed++; Job.Resolve(); }
				catch(E) { this.Stats.failed++; Job.Reject(E); }
			}
		}
		finally { this.Running = false; }
	}
}

export const CheckpointPolicy = { intervalMs: 1000, addedBytes: 32 * 1024, retryMaxMs: 30_000 };
export interface CheckpointContext
{
	Signal: AbortSignal;
	is_current(): boolean;
}
interface PendingCheckpoint
{
	Added: number;
	Version: number;
	Work: (Context: CheckpointContext) => unknown;
	Timer?: ReturnType<typeof setTimeout>;
	InFlight?: Promise<void>;
	Controller: AbortController;
	Failures: number;
}
export class StreamCheckpoints
{
	private Pending = new Map<string, PendingCheckpoint>();
	private Closed = false;
	readonly Stats = { offered: 0, attempts: 0, checkpoints: 0, superseded: 0, failed: 0, retries: 0, addedBytes: 0, peakPending: 0 };
	constructor(private Interval = CheckpointPolicy.intervalMs, private ByteLimit = CheckpointPolicy.addedBytes, private OnError?: (E: unknown) => void) {}
	get pending(): number { return this.Pending.size; }
	offer(Key: string, AddedBytes: number, Work: (Context: CheckpointContext) => unknown): void
	{
		if(this.Closed) { throw new Error("检查点已关闭, 不接收新任务"); }
		this.Stats.offered++; this.Stats.addedBytes += Math.max(0, AddedBytes);
		let Current = this.Pending.get(Key);
		if(!Current)
		{
			Current = { Added: 0, Version: 0, Work, Controller: new AbortController(), Failures: 0 };
			this.Pending.set(Key, Current); this.schedule(Key, Current, this.Interval);
			this.Stats.peakPending = Math.max(this.Stats.peakPending, this.Pending.size);
		}
		Current.Work = Work; Current.Version++; Current.Added += Math.max(0, AddedBytes);
		if(Current.Added >= this.ByteLimit && !Current.InFlight) { void this.flush(Key).catch(() => {}); }
	}
	private schedule(Key: string, P: PendingCheckpoint, Delay: number): void
	{
		if(this.Closed || this.Pending.get(Key) !== P || P.Timer) { return; }
		P.Timer = setTimeout(() => { P.Timer = undefined; void this.flush(Key).catch(() => {}); }, Delay);
	}
	forget(Key: string): Promise<void>
	{
		const P = this.Pending.get(Key); if(!P) { return Promise.resolve(); }
		if(P.Timer) { clearTimeout(P.Timer); } P.Controller.abort(); this.Pending.delete(Key);
		return P.InFlight?.catch(() => {}) ?? Promise.resolve();
	}
	flush(Key?: string): Promise<void>
	{
		if(Key === undefined) { return Promise.all([...this.Pending.keys()].map(K => this.flush(K))).then(() => {}); }
		const P = this.Pending.get(Key); if(!P) { return Promise.resolve(); }
		if(P.InFlight) { return P.InFlight.then(() => this.Pending.get(Key) === P ? this.flush(Key) : undefined); }
		if(P.Timer) { clearTimeout(P.Timer); P.Timer = undefined; }
		this.Stats.attempts++; if(P.Failures) { this.Stats.retries++; }
		const Version = P.Version, Added = P.Added;
		const Context: CheckpointContext = { Signal: P.Controller.signal, is_current: () => this.Pending.get(Key) === P && P.Version === Version && !P.Controller.signal.aborted };
		const Success = (Saved: unknown) =>
		{
			if(this.Pending.get(Key) !== P) { return; }
			if(Saved===false){this.Stats.superseded++;}else{this.Stats.checkpoints++;} P.Failures = 0; P.Added = Math.max(0, P.Added - Added);
			if(P.Version === Version) { this.Pending.delete(Key); }
		};
		const Failure = (E: unknown) =>
		{
			if(this.Pending.get(Key) === P)
			{
				this.Stats.failed++; P.Failures++;
				try { this.OnError?.(E); } catch { /* Error reporting must not discard retry work. */ }
			}
			throw E;
		};
		const Finished = () =>
		{
			P.InFlight = undefined;
			if(this.Pending.get(Key) !== P) { return; }
			this.schedule(Key, P, P.Failures ? Math.min(CheckpointPolicy.retryMaxMs, Math.max(1, this.Interval) * 2 ** Math.min(P.Failures - 1, 10)) : this.Interval);
		};
		try
		{
			const Result = P.Work(Context);
			if(Result && typeof (Result as PromiseLike<unknown>).then === "function")
			{
				const Running = Promise.resolve(Result).then(Success, Failure).finally(Finished); P.InFlight = Running;
				return Running.then(() => this.Pending.get(Key) === P && P.Version !== Version ? this.flush(Key) : undefined);
			}
			Success(Result); Finished(); return Promise.resolve();
		}
		catch(E)
		{
			try { Failure(E); } catch(ErrorValue) { Finished(); return Promise.reject(ErrorValue); }
			return Promise.resolve();
		}
	}
	async close(): Promise<void>
	{
		this.Closed = true;
		for(const P of this.Pending.values()) { if(P.Timer) { clearTimeout(P.Timer); P.Timer = undefined; } }
		// Hosts that do not await unload cannot guarantee completion; failures remain inspectable/retryable.
		while(this.Pending.size)
		{
			await this.flush();
		}
	}
}
