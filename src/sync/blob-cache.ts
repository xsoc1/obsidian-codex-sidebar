export class BlobCache
{
	private Values = new Map<string, { Value: unknown; Bytes: number }>();
	private Bytes = 0;
	private PeakBytes = 0;
	constructor(readonly LimitBytes = 8 * 1024 * 1024) { if(!Number.isSafeInteger(LimitBytes) || LimitBytes < 0) { throw new Error("blob 缓存预算无效"); } }
	get(Id: string): unknown | undefined
	{
		const Entry = this.Values.get(Id); if(!Entry) { return undefined; }
		this.Values.delete(Id); this.Values.set(Id, Entry); return structuredClone(Entry.Value);
	}
	put(Id: string, Value: unknown, Bytes: number): void
	{
		const Previous = this.Values.get(Id); if(Previous) { this.Bytes -= Previous.Bytes; this.Values.delete(Id); }
		if(Bytes > this.LimitBytes) { return; }
		while(this.Bytes + Bytes > this.LimitBytes)
		{
			const Key = this.Values.keys().next().value; if(Key === undefined) { break; } this.Bytes -= this.Values.get(Key)!.Bytes; this.Values.delete(Key);
		}
		this.Values.set(Id, { Value: structuredClone(Value), Bytes }); this.Bytes += Bytes; this.PeakBytes = Math.max(this.PeakBytes, this.Bytes);
	}
	stats() { return { Entries: this.Values.size, Utf8Bytes: this.Bytes, PeakUtf8Bytes: this.PeakBytes, LimitUtf8Bytes: this.LimitBytes }; }
}
