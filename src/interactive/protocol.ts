import { markdown_blocks } from "../markdown-blocks";
import { validate_plot, type PlotSpec } from "./plot";
import { validate_symbol, type SymbolSpec } from "./symbols";

export interface InteractiveSpec { schemaVersion: 1; plots: PlotSpec[]; symbols: SymbolSpec[]; }
export interface InteractiveOutput { Status: "none" | "pending" | "ready" | "invalid"; Spec?: InteractiveSpec; Raw?: string; From?: number; To?: number; Error?: string; }
export const InteractiveBudget = 24000;

export function validate_interactive(Value: unknown): InteractiveSpec
{
	const V = Value as InteractiveSpec;
	if(!V || typeof V !== "object" || Array.isArray(V) || Object.keys(V).some(K => !["schemaVersion", "plots", "symbols"].includes(K)) || V.schemaVersion !== 1 || !Array.isArray(V.plots) || !Array.isArray(V.symbols) || V.plots.length > 2 || V.symbols.length > 12 || !V.plots.length && !V.symbols.length) { throw Error("交互内容格式无效或超过预算"); }
	const Spec: InteractiveSpec = { schemaVersion: 1, plots: V.plots.map(validate_plot), symbols: V.symbols.map(validate_symbol) };
	const Ids = [...Spec.plots, ...Spec.symbols].map(V => V.id);
	if(new Set(Ids).size !== Ids.length) { throw Error("交互组件 ID 重复"); }
	if(JSON.stringify(Spec).length > InteractiveBudget) { throw Error("交互内容超过预算"); }
	return Spec;
}

/** The source remains immutable. Only a complete top-level fence can become controls. */
export function interactive_output(Text: string, Completed: boolean): InteractiveOutput
{
	if(!Text.includes("codex-ui")) { return { Status: "none" }; }
	const Blocks = markdown_blocks(Text).filter(B => B.Kind === "code" && /^(?:`{3,}|~{3,})codex-ui\s*\r?\n/.test(B.Text));
	if(!Blocks.length) { return { Status: "none" }; }
	if(!Completed) { return { Status: "pending" }; }
	try
	{
		if(Blocks.length !== 1 || !Blocks[0].Closed) { throw Error("交互内容重复或被截断"); }
		const B = Blocks[0], Raw = B.Text.slice(B.Text.indexOf("\n") + 1, B.Text.lastIndexOf("\n")).trim();
		if(Raw.length > InteractiveBudget) { throw Error("交互内容超过预算"); }
		return { Status: "ready", Spec: validate_interactive(JSON.parse(Raw)), Raw, From: B.From, To: B.To };
	}
	catch(E) { return { Status: "invalid", Error: E instanceof Error ? E.message : "交互内容无法校验" }; }
}

export function interactive_markdown(Text: string, Output: InteractiveOutput): string
{
	return Output.Status === "ready" && Output.From !== undefined && Output.To !== undefined ? (Text.slice(0, Output.From).trimEnd() + "\n\n" + Text.slice(Output.To).trimStart()).trim() : Text;
}
