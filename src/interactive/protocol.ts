import { markdown_blocks } from "../markdown-blocks";
import { validate_plot, type PlotSpec } from "./plot";
import { validate_symbol, type SymbolSpec } from "./symbols";
import { validate_relation, validate_walkthrough, type RelationSpec, type WalkthroughSpec } from "./structures";
import { data_list, data_record } from "./validation";

export interface InteractiveSpec { schemaVersion: 1; plots: PlotSpec[]; symbols: SymbolSpec[]; relations?: RelationSpec[]; walkthroughs?: WalkthroughSpec[]; }
export interface InteractiveOutput { Status: "none" | "pending" | "ready" | "invalid"; Spec?: InteractiveSpec; Raw?: string; From?: number; To?: number; Error?: string; }
export const InteractiveBudget = 24000;

export function validate_interactive(Value: unknown): InteractiveSpec
{
	const V = data_record(Value, ["schemaVersion", "plots", "symbols", "relations", "walkthroughs"], ["schemaVersion", "plots", "symbols"]);
	if(V.schemaVersion !== 1) { throw Error("交互内容格式无效或超过预算"); }
	const Spec: InteractiveSpec = { schemaVersion: 1, plots: data_list(V.plots, 2).map(validate_plot), symbols: data_list(V.symbols, 12).map(validate_symbol) };
	// Absent optional fields stay absent: legacy spec serialization is a state key.
	if(Object.hasOwn(V, "relations")) { Spec.relations = data_list(V.relations, 2).map(validate_relation); }
	if(Object.hasOwn(V, "walkthroughs")) { Spec.walkthroughs = data_list(V.walkthroughs, 2).map(validate_walkthrough); }
	const Ids = [...Spec.plots, ...Spec.symbols, ...(Spec.relations ?? []), ...(Spec.walkthroughs ?? [])].map(V => V.id);
	if(!Ids.length) { throw Error("交互组件不能为空"); }
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
