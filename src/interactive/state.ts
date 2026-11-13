import { text_identity } from "../markdown-blocks";
import { plot_values } from "./plot";
import type { InteractiveSpec } from "./protocol";

export interface InteractiveState { Values: Record<string, Record<string, number>>; Symbol: string; }
interface StorageLike { getItem(Key: string): string | null; setItem(Key: string, Value: string): void; }
interface SavedState extends InteractiveState { schemaVersion: 1; Spec: string; Revision: number; }

/** Device-local state, deliberately excluded from whole-chat remote sync. */
export class InteractiveStateStore
{
	readonly Key: string;
	private Expected: string | null = null;
	private SpecText: string;
	constructor(private Storage: StorageLike, Scope: string, Session: string, Message: string, private Spec: InteractiveSpec)
	{
		if([Scope, Session, Message].some(V => !V || V.length > 4096)) { throw Error("交互状态作用域无效"); }
		this.SpecText = JSON.stringify(Spec);
		this.Key = "codex-sidebar-interactive:v1:" + [Scope, Session, Message, text_identity(this.SpecText)].map(encodeURIComponent).join(":");
	}
	private values(Value?: InteractiveState): InteractiveState
	{
		return { Values: Object.fromEntries(this.Spec.plots.map(P => [P.id, plot_values(P, Value?.Values?.[P.id])])), Symbol: this.Spec.symbols.some(S => S.id === Value?.Symbol) ? Value!.Symbol : "" };
	}
	load(): InteractiveState
	{
		const Raw = this.Storage.getItem(this.Key);
		if(!Raw) { this.Expected = null; return this.values(); }
		const V = JSON.parse(Raw) as SavedState;
		if(!V || V.schemaVersion !== 1 || V.Spec !== this.SpecText || !Number.isSafeInteger(V.Revision) || V.Revision < 1 || !V.Values || typeof V.Values !== "object" || Array.isArray(V.Values) || typeof V.Symbol !== "string" || Object.keys(V).some(K => !["schemaVersion", "Spec", "Revision", "Values", "Symbol"].includes(K))) { throw Error("交互状态损坏或版本不匹配, 原数据保留"); }
		this.Expected = Raw; return this.values(V);
	}
	save(State: InteractiveState): void
	{
		if(this.Storage.getItem(this.Key) !== this.Expected) { throw Error("另一窗口已调整交互状态, 请重新打开会话核对; 未覆盖其参数"); }
		const Revision = this.Expected ? (JSON.parse(this.Expected) as SavedState).Revision + 1 : 1;
		const Raw = JSON.stringify({ schemaVersion: 1, Spec: this.SpecText, Revision, ...this.values(State) });
		this.Storage.setItem(this.Key, Raw);
		if(this.Storage.getItem(this.Key) !== Raw) { throw Error("交互状态保存未确认, 当前图仍可使用"); }
		this.Expected = Raw;
	}
}
