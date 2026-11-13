import { validate_symbol, type SymbolSpec } from "./symbols";
import { data_list, data_record } from "./validation";

export interface RelationEdge { from: string; to: string; label: string; }
export interface RelationSpec { id: string; title: string; nodes: SymbolSpec[]; edges: RelationEdge[]; }
export interface WalkthroughSpec { id: string; title: string; steps: SymbolSpec[]; }

function heading(Value: Record<string, unknown>): { id: string; title: string }
{
	const S = validate_symbol({ id: Value.id, symbol: Value.title, meaning: "结构导航" });
	return { id: S.id, title: S.symbol };
}

function entries(Value: unknown, Limit: number): SymbolSpec[]
{
	const Items = data_list(Value, Limit, 1).map(validate_symbol);
	if(new Set(Items.map(S => S.id)).size !== Items.length) { throw Error("结构内 ID 重复"); }
	return Items;
}

export function validate_relation(Value: unknown): RelationSpec
{
	const V = data_record(Value, ["id", "title", "nodes", "edges"]), H = heading(V), Nodes = entries(V.nodes, 8);
	const Edges = data_list(V.edges, 12).map(Value =>
	{
		const E = data_record(Value, ["from", "to", "label"]);
		if(typeof E.from !== "string" || typeof E.to !== "string" || !Nodes.some(S => S.id === E.from) || !Nodes.some(S => S.id === E.to)) { throw Error("关系的端点必须引用本组节点"); }
		const Label = validate_symbol({ id: "edge", symbol: E.label, meaning: "方向关系" }).symbol;
		return { from: E.from, to: E.to, label: Label };
	});
	return { ...H, nodes: Nodes, edges: Edges };
}

export function validate_walkthrough(Value: unknown): WalkthroughSpec
{
	const V = data_record(Value, ["id", "title", "steps"]);
	return { ...heading(V), steps: entries(V.steps, 10) };
}
