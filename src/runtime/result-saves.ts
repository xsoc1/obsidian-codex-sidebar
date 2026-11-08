export interface ResultSave<T>
{
	Key: string;
	Value: T;
	Saving: boolean;
	Failures: number;
	Error?: string;
}
interface Job<T> extends ResultSave<T>
{
	Work(): Promise<void>;
	Running?: Promise<void>;
	Timer?: ReturnType<typeof setTimeout>;
}

// Observations are durable barriers, not replaceable stream checkpoints.
export class ResultSaves<T>
{
	private Jobs = new Map<string, Job<T>>();
	private Closed = false;
	readonly Stats = { received: 0, attempts: 0, saved: 0, failed: 0 };
	constructor(private Changed: () => void, private Delay = 250, private AutoAttempts = 4) {}
	get pending(): number { return this.Jobs.size; }
	get values(): ResultSave<T>[] { return [...this.Jobs.values()]; }
	retain(Key: string, Value: T, Work: () => Promise<void>): Promise<void>
	{
		let Job = this.Jobs.get(Key);
		if(!Job)
		{
			Job = { Key, Value, Work, Saving: false, Failures: 0 };
			this.Jobs.set(Key, Job); this.Stats.received++; this.Changed();
		}
		return this.save(Job);
	}
	private save(Job: Job<T>): Promise<void>
	{
		if(Job.Running) { return Job.Running; }
		if(Job.Timer) { clearTimeout(Job.Timer); Job.Timer = undefined; }
		Job.Saving = true; this.Stats.attempts++;
		// Start after Running is installed, including for synchronously rejected adapters.
		Job.Running = Promise.resolve().then(Job.Work).then(() =>
		{
			this.Jobs.delete(Job.Key); this.Stats.saved++;
		}, E =>
		{
			Job.Failures++; this.Stats.failed++;
			Job.Error = E instanceof Error ? E.message : String(E);
		}).finally(() =>
		{
			Job.Running = undefined; Job.Saving = false;
			if(!this.Closed && this.Jobs.has(Job.Key) && Job.Failures < this.AutoAttempts)
			{
				Job.Timer = setTimeout(() => { Job.Timer = undefined; void this.save(Job); }, Math.min(30_000, this.Delay * 2 ** Math.max(0, Job.Failures - 1)));
			}
			this.Changed();
		});
		this.Changed(); return Job.Running;
	}
	async retry(): Promise<void> { await Promise.all([...this.Jobs.values()].map(Job => this.save(Job))); }
	async close(): Promise<void>
	{
		this.Closed = true;
		for(const Job of this.Jobs.values()) { if(Job.Timer) { clearTimeout(Job.Timer); Job.Timer = undefined; } }
		await this.retry();
	}
}
