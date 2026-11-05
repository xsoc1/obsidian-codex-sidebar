export interface SseEvent { Event: string; Data: string; Id?: string; }

// SSE dispatch requires a blank line; an unterminated EOF frame is not a result.
export class SseDecoder
{
	private Decoder = new TextDecoder("utf-8", { fatal: true });
	private Buffer = "";
	private Data: string[] = [];
	private Event = "";
	private Id: string | undefined;
	private FrameLength = 0;
	constructor(private Emit: (Event: SseEvent) => void, private MaxFrame = 2 * 1024 * 1024) {}
	push(Bytes: Uint8Array): void { this.consume(this.Decoder.decode(Bytes, { stream: true })); }
	finish(): void
	{
		this.consume(this.Decoder.decode());
		if(this.Buffer.endsWith("\r")) { this.consume("\n"); }
	}
	private consume(Text: string): void
	{
		this.Buffer += Text;
		let Start = 0;
		for(let I = 0; I < this.Buffer.length; I++)
		{
			const C = this.Buffer[I];
			if(C !== "\r" && C !== "\n") { continue; }
			if(C === "\r" && I === this.Buffer.length - 1) { break; }
			this.line(this.Buffer.slice(Start, I));
			if(C === "\r" && this.Buffer[I + 1] === "\n") { I++; }
			Start = I + 1;
		}
		this.Buffer = this.Buffer.slice(Start);
		if(this.Buffer.length + this.FrameLength > this.MaxFrame) { throw new Error("SSE 帧超过长度限制"); }
	}
	private line(Line: string): void
	{
		this.FrameLength += Line.length;
		if(this.FrameLength > this.MaxFrame) { throw new Error("SSE 帧超过长度限制"); }
		if(!Line)
		{
			if(this.Data.length) { this.Emit({ Event: this.Event || "message", Data: this.Data.join("\n"), ...(this.Id !== undefined ? { Id: this.Id } : {}) }); }
			this.Data = []; this.Event = ""; this.FrameLength = 0; this.Id = undefined;
			return;
		}
		if(Line.startsWith(":")) { return; }
		const Colon = Line.indexOf(":"), Field = Colon < 0 ? Line : Line.slice(0, Colon);
		let Value = Colon < 0 ? "" : Line.slice(Colon + 1);
		if(Value.startsWith(" ")) { Value = Value.slice(1); }
		if(Field === "data") { this.Data.push(Value); }
		else if(Field === "event") { this.Event = Value; }
		else if(Field === "id" && !Value.includes("\0")) { this.Id = Value; }
	}
}

export interface StreamBudget { FirstEventMs: number; IdleMs: number; TotalMs: number; MaxBytes: number; }
export const DefaultStreamBudget: StreamBudget = { FirstEventMs: 90000, IdleMs: 90000, TotalMs: 15 * 60000, MaxBytes: 16 * 1024 * 1024 };

// The timer covers each actual read, not a fixed deadline on the whole derivation.
export async function stream_step<T>(Work: PromiseLike<T>, Ms: number, Reason: string, Signal?: AbortSignal): Promise<T>
{
	Signal?.throwIfAborted();
	let Timer: ReturnType<typeof setTimeout> | undefined;
	let Abort: (() => void) | undefined;
	const Deadline = new Promise<never>((_, Reject) =>
	{
		Timer = setTimeout(() => Reject(new Error(Reason)), Math.max(1, Ms));
		Abort = () => Reject(new Error("已停止等待; 服务端取消未确认"));
		Signal?.addEventListener("abort", Abort, { once: true });
	});
	try { return await Promise.race([Work, Deadline]); }
	finally { clearTimeout(Timer); if(Abort) { Signal?.removeEventListener("abort", Abort); } }
}
