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

export const CheckpointPolicy = { intervalMs: 1000, addedBytes: 32 * 1024 };
interface PendingCheckpoint { Added: number; Work: () => void; Timer: ReturnType<typeof setTimeout>; }
export class StreamCheckpoints
{
	private Pending = new Map<string, PendingCheckpoint>();
	readonly Stats = { offered: 0, checkpoints: 0, failed: 0, addedBytes: 0, peakPending: 0 };
	constructor(private Interval = CheckpointPolicy.intervalMs, private ByteLimit = CheckpointPolicy.addedBytes, private OnError?: (E: unknown) => void) {}
	offer(Key: string, AddedBytes: number, Work: () => void): void
	{
		this.Stats.offered++; this.Stats.addedBytes += Math.max(0, AddedBytes);
		let Current = this.Pending.get(Key);
		if(!Current)
		{
			Current = { Added: 0, Work, Timer: setTimeout(() => this.flush(Key), this.Interval) };
			this.Pending.set(Key, Current); this.Stats.peakPending = Math.max(this.Stats.peakPending, this.Pending.size);
		}
		Current.Work = Work; Current.Added += Math.max(0, AddedBytes);
		if(Current.Added >= this.ByteLimit) { this.flush(Key); }
	}
	forget(Key: string): void { const P = this.Pending.get(Key); if(P) { clearTimeout(P.Timer); this.Pending.delete(Key); } }
	flush(Key?: string): void
	{
		if(Key === undefined) { for(const K of [...this.Pending.keys()]) { this.flush(K); } return; }
		const P = this.Pending.get(Key); if(!P) { return; }
		clearTimeout(P.Timer);
		try { P.Work(); this.Pending.delete(Key); this.Stats.checkpoints++; }
		catch(E)
		{
			this.Stats.failed++;
			if(!this.OnError) { throw E; }
			P.Timer = setTimeout(() => this.flush(Key), this.Interval); this.OnError(E);
		}
	}
	close(): void { for(const Key of [...this.Pending.keys()]) { this.forget(Key); } }
}
