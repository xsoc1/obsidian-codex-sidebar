import type { EditData, EditRecord, EditStore } from "./store";

export interface CacheContext { Key: string; Turns: string[]; }
export interface EditCacheState { Context: string; Seen: string[]; Remaining: number | null; Armed: boolean; }

export function cache_turns(Value: unknown): number
{
	if(Value === undefined) { return 1; }
	if(typeof Value !== "number" || !Number.isSafeInteger(Value) || Value < 0 || Value > 1000) { throw new Error("缓存保留轮数须为 1-1000, 或永不"); }
	return Value;
}
function string_ids(Value: unknown): Value is string[] { return Array.isArray(Value) && Value.every(Id => typeof Id === "string" && Id.length > 0 && Id.length <= 256) && new Set(Value).size === Value.length; }
export function validate_cache(Data: EditData): void
{
	cache_turns(Data.CacheTurns);
	if(Data.ExpiredIds !== undefined && !string_ids(Data.ExpiredIds)) { throw new Error("修改缓存清理标记损坏, 原记录保留"); }
	for(const Record of Data.Records)
	{
		const C = Record.Cache;
		if(C !== undefined && (!C || Object.keys(C).some(Key => !["Context", "Seen", "Remaining", "Armed"].includes(Key)) || typeof C.Context !== "string" || C.Context.length > 256 || !C.Context || !string_ids(C.Seen) || typeof C.Armed !== "boolean" || (C.Remaining !== null && (!Number.isSafeInteger(C.Remaining) || C.Remaining < 0 || C.Remaining > 1000)))) { throw new Error("修改缓存计数损坏, 原记录保留"); }
	}
}
export function cache_owner(Context: CacheContext | null): EditCacheState | undefined
{
	return Context ? { Context: Context.Key, Seen: [...new Set(Context.Turns)], Remaining: null, Armed: false } : undefined;
}
export function arm_cache(Data: EditData, Record: EditRecord, Context: CacheContext | null): void
{
	if(!Record.Cache || !Context || Record.Cache.Context !== Context.Key) { return; }
	Record.Cache.Seen = [...new Set(Context.Turns)]; Record.Cache.Remaining = cache_turns(Data.CacheTurns) || null; Record.Cache.Armed = true;
}

export class EditCache
{
	Error = "";
	private Work: Promise<void> | null = null;
	private FailureKey = "";
	constructor(private Store: EditStore, private Context: (Key?: string) => CacheContext | null, private Blocked: () => boolean, private Changed: () => void) { }
	get Working(): boolean { return !!this.Work; }
	get Turns(): number { return cache_turns(this.Store.Data.CacheTurns); }
	async set_turns(Value: number): Promise<void>
	{
		cache_turns(Value); await this.Work;
		await this.Store.change(Data =>
		{
			Data.CacheTurns = Value;
			for(const Record of Data.Records) { if(Record.Cache?.Armed) { Record.Cache.Remaining = null; if(Value) { arm_cache(Data, Record, this.Context(Record.Cache.Context)); } } }
		});
		this.FailureKey = ""; this.Error = ""; this.Changed();
	}
	poll(): void
	{
		const Context = this.Context();
		if(this.Work || this.Blocked() || !Context) { return; }
		const Key = JSON.stringify(Context);
		if(Key === this.FailureKey || !this.Turns || !this.Store.Data.Records.some(R =>
		{
			const C = R.Cache, Plans = this.Store.Data.Writes.filter(P => P.TaskId === R.Spec.Id);
			return C?.Armed && C.Context === Context.Key && (C.Remaining === null || Context.Turns.some(Id => !C.Seen.includes(Id)) || (C.Remaining === 0 && Plans.length && Plans.every(P => ["preview", "applied", "undone"].includes(P.State) && !P.UndoPending)));
		})) { return; }
		const Work = Promise.resolve().then(async () =>
		{
			if(this.Blocked()) { return; }
			let Removed = false;
			await this.Store.change(Data =>
			{
				if(this.Blocked()) { return; }
				const Expired = new Set<string>();
				for(const R of Data.Records)
				{
					const C = R.Cache;
					if(!C?.Armed || C.Context !== Context.Key) { continue; }
					if(C.Remaining === null) { arm_cache(Data, R, Context); continue; }
					const Fresh = Context.Turns.filter(Id => !C.Seen.includes(Id)); C.Seen = [...new Set([...C.Seen, ...Fresh])];
					if(C.Remaining === null) { continue; }
					C.Remaining = Math.max(0, C.Remaining - Fresh.length);
					const Plans = Data.Writes.filter(P => P.TaskId === R.Spec.Id);
					if(C.Remaining === 0 && R.Status === "complete" && Plans.length && Plans.every(P => ["preview", "applied", "undone"].includes(P.State) && !P.UndoPending)) { Expired.add(R.Spec.Id); }
				}
				if(Expired.size)
				{
					Data.Records = Data.Records.filter(R => !Expired.has(R.Spec.Id)); Data.Writes = Data.Writes.filter(P => !Expired.has(P.TaskId));
					Data.ExpiredIds = [...new Set([...(Data.ExpiredIds ?? []), ...Expired])]; Removed = true;
				}
			});
			this.Error = ""; if(Removed) { this.Changed(); }
		});
		this.Work = Work.catch(ErrorValue => { this.FailureKey = Key; this.Error = "修改缓存未清理, 原记录保留: " + String(ErrorValue); this.Changed(); }).finally(() => { this.Work = null; this.poll(); });
	}
	async flush(): Promise<void> { await this.Work; }
}
