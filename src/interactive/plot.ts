export interface PlotParameter
{
	name: string;
	label: string;
	min: number;
	max: number;
	step: number;
	value: number;
}

export interface PlotSpec
{
	id: string;
	title: string;
	expression: string;
	x: { min: number; max: number };
	y?: { min: number; max: number };
	parameters: PlotParameter[];
	caption?: string;
}

const MaxMagnitude = 1e6, MaxTokens = 256, MaxDepth = 32, MaxSamples = 1025;
const Functions = new Map<string, (Value: number) => number>([
	["sin", Math.sin], ["cos", Math.cos], ["tan", Math.tan],
	["asin", Math.asin], ["acos", Math.acos], ["atan", Math.atan],
	["exp", Math.exp], ["log", Math.log], ["sqrt", Math.sqrt], ["abs", Math.abs]
]);
const Forbidden = new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype", "x", "pi", "e", ...Functions.keys()]);
type Ast = { height: number } & (
	{ kind: "number"; value: number } |
	{ kind: "variable"; name: string } |
	{ kind: "unary"; operator: string; right: Ast } |
	{ kind: "call"; name: string; right: Ast } |
	{ kind: "binary"; operator: string; left: Ast; right: Ast }
);

function invalid(Message: string): never { throw new Error("参数图: " + Message); }

function record(Value: unknown, Allowed: readonly string[], Required: readonly string[] = Allowed): Record<string, unknown>
{
	if(!Value || typeof Value !== "object" || Array.isArray(Value)) { return invalid("需要普通对象"); }
	const Prototype = Object.getPrototypeOf(Value);
	if(Prototype !== Object.prototype && Prototype !== null) { return invalid("对象原型无效"); }
	const Keys = Reflect.ownKeys(Value);
	if(Keys.length > Allowed.length) { return invalid("存在未知字段"); }
	for(const Key of Keys)
	{
		if(typeof Key !== "string" || !Allowed.includes(Key)) { return invalid("存在未知字段"); }
		if(!Object.hasOwn(Object.getOwnPropertyDescriptor(Value, Key)!, "value")) { return invalid("字段不能是访问器"); }
	}
	for(const Key of Required) { if(!Object.hasOwn(Value, Key)) { return invalid("缺少字段 " + Key); } }
	return Value as Record<string, unknown>;
}

function text(Value: unknown, Limit: number): string
{
	if(typeof Value !== "string" || !Value.trim() || Value.length > Limit || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(Value)) { return invalid("文本为空、过长或包含控制字符"); }
	return Value;
}

function finite(Value: unknown): number
{
	if(typeof Value !== "number" || !Number.isFinite(Value)) { return invalid("数值必须有限"); }
	return Value;
}

function range(Value: unknown): { min: number; max: number }
{
	const R = record(Value, ["min", "max"]), Min = finite(R.min), Max = finite(R.max);
	if(Math.abs(Min) > MaxMagnitude || Math.abs(Max) > MaxMagnitude || Max - Min < 1e-9) { return invalid("范围必须递增, 端点绝对值不超过 1000000, 跨度至少 1e-9"); }
	return { min: Min, max: Max };
}

function normalize(Parameter: PlotParameter, Value: number): number
{
	const Last = Math.floor((Parameter.max - Parameter.min) / Parameter.step + 1e-9);
	const Index = Math.max(0, Math.min(Last, Math.round((Value - Parameter.min) / Parameter.step)));
	function decimals(NumberValue: number): number
	{
		const [Coefficient, Exponent = "0"] = NumberValue.toString().toLowerCase().split("e");
		return Math.max(0, (Coefficient.split(".")[1]?.length ?? 0) - Number(Exponent));
	}
	const Digits = Math.min(100, Math.max(decimals(Parameter.min), decimals(Parameter.step)));
	return Math.max(Parameter.min, Math.min(Parameter.max, Number((Parameter.min + Index * Parameter.step).toFixed(Digits))));
}

function parse(Expression: string, Names: Set<string>): Ast
{
	const Tokens: string[] = [];
	const Lexer = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/^()]))/y;
	let Offset = 0;
	while(Offset < Expression.length)
	{
		if(!Expression.slice(Offset).trim()) { break; }
		Lexer.lastIndex = Offset;
		const Match = Lexer.exec(Expression);
		if(!Match) { return invalid("表达式含非法字符"); }
		Tokens.push(Match[1] ?? Match[2] ?? Match[3]); Offset = Lexer.lastIndex;
		if(Tokens.length > MaxTokens) { return invalid("表达式 token 超过 256"); }
	}
	let Position = 0;
	function bounded(Node: Ast): Ast
	{
		if(Node.height > MaxDepth) { return invalid("表达式嵌套超过 32"); }
		return Node;
	}
	function expression(Minimum: number, Depth: number): Ast
	{
		if(Depth > MaxDepth) { return invalid("表达式嵌套超过 32"); }
		const Token = Tokens[Position++];
		let Left: Ast;
		if(Token === "+" || Token === "-")
		{
			const Right = expression(30, Depth + 1);
			Left = bounded({ kind: "unary", operator: Token, right: Right, height: Right.height + 1 });
		}
		else if(Token === "(")
		{
			Left = expression(0, Depth + 1);
			if(Tokens[Position++] !== ")") { return invalid("括号不匹配"); }
		}
		else if(Token && /^(?:\d|\.)/.test(Token)) { Left = { kind: "number", value: finite(Number(Token)), height: 1 }; }
		else if(Token === "pi" || Token === "e") { Left = { kind: "number", value: Token === "pi" ? Math.PI : Math.E, height: 1 }; }
		else if(Functions.has(Token))
		{
			if(Tokens[Position++] !== "(") { return invalid("函数需要括号"); }
			const Right = expression(0, Depth + 1);
			if(Tokens[Position++] !== ")") { return invalid("函数仅接受一个参数"); }
			Left = bounded({ kind: "call", name: Token, right: Right, height: Right.height + 1 });
		}
		else if(Names.has(Token)) { Left = { kind: "variable", name: Token, height: 1 }; }
		else { return invalid("未知变量、函数或缺少操作数"); }
		while(Position < Tokens.length)
		{
			const Operator = Tokens[Position], Power = Operator === "+" || Operator === "-" ? 10 : Operator === "*" || Operator === "/" ? 20 : Operator === "^" ? 40 : -1;
			if(Power < Minimum) { break; }
			Position++;
			const Right = expression(Power + (Operator === "^" ? 0 : 1), Depth + 1);
			Left = bounded({ kind: "binary", operator: Operator, left: Left, right: Right, height: Math.max(Left.height, Right.height) + 1 });
		}
		return Left;
	}
	const Tree = expression(0, 0);
	if(Position !== Tokens.length) { return invalid("表达式存在多余 token"); }
	return Tree;
}

function checked(Value: unknown): { spec: PlotSpec; tree: Ast }
{
	const R = record(Value, ["id", "title", "expression", "x", "y", "parameters", "caption"], ["id", "title", "expression", "x", "parameters"]);
	const Id = text(R.id, 64), Title = text(R.title, 120), Expression = text(R.expression, 512);
	if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(Id) || Forbidden.has(Id)) { return invalid("图标识无效"); }
	const X = range(R.x), Y = Object.hasOwn(R, "y") ? range(R.y) : undefined;
	if(!Array.isArray(R.parameters) || R.parameters.length > 4) { return invalid("参数必须为数组, 最多 4 个"); }
	const Items = R.parameters;
	if(Object.getPrototypeOf(Items) !== Array.prototype || Reflect.ownKeys(Items).length !== Items.length + 1) { return invalid("参数数组存在未知字段或缺项"); }
	for(let Index = 0; Index < Items.length; Index++)
	{
		const Descriptor = Object.getOwnPropertyDescriptor(Items, String(Index));
		if(!Descriptor || !Object.hasOwn(Descriptor, "value")) { return invalid("参数数组不能有缺项或访问器"); }
	}
	const Names = new Set(["x"]), Parameters: PlotParameter[] = [];
	for(const Item of Items)
	{
		const P = record(Item, ["name", "label", "min", "max", "step", "value"]), Name = text(P.name, 32), Label = text(P.label, 64);
		if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(Name) || Forbidden.has(Name) || Names.has(Name)) { return invalid("参数名重复、保留或无效"); }
		const Bounds = range({ min: P.min, max: P.max }), Step = finite(P.step), Initial = finite(P.value);
		if(Step <= 0 || Step > Bounds.max - Bounds.min || (Bounds.max - Bounds.min) / Step > 10000 || Bounds.min + Step === Bounds.min) { return invalid("步长无效或步数超过 10000"); }
		if(Initial < Bounds.min || Initial > Bounds.max) { return invalid("初始参数超出范围"); }
		const Parameter = { name: Name, label: Label, ...Bounds, step: Step, value: Initial };
		Parameter.value = normalize(Parameter, Initial); Parameters.push(Parameter); Names.add(Name);
	}
	const Spec: PlotSpec = { id: Id, title: Title, expression: Expression, x: X, parameters: Parameters };
	if(Y) { Spec.y = Y; }
	if(Object.hasOwn(R, "caption")) { Spec.caption = text(R.caption, 500); }
	return { spec: Spec, tree: parse(Expression, Names) };
}

export function validate_plot(Value: unknown): PlotSpec { return checked(Value).spec; }

function parameter_values(Spec: PlotSpec, Values?: Record<string, number>): Record<string, number>
{
	const Input = Values === undefined ? {} : record(Values, Spec.parameters.map(P => P.name), []);
	const Output: Record<string, number> = {};
	for(const P of Spec.parameters) { Output[P.name] = normalize(P, Object.hasOwn(Input, P.name) ? finite(Input[P.name]) : P.value); }
	return Output;
}

export function plot_values(Spec: PlotSpec, Values?: Record<string, number>): Record<string, number>
{
	return parameter_values(validate_plot(Spec), Values);
}

function evaluate(Node: Ast, X: number, Values: Record<string, number>): number
{
	if(Node.kind === "number") { return Node.value; }
	if(Node.kind === "variable") { return Node.name === "x" ? X : Values[Node.name]; }
	const Right = evaluate(Node.right, X, Values);
	if(!Number.isFinite(Right)) { return NaN; }
	if(Node.kind === "unary") { return Node.operator === "-" ? -Right : Right; }
	if(Node.kind === "call") { return Functions.get(Node.name)!(Right); }
	const Left = evaluate(Node.left, X, Values);
	if(!Number.isFinite(Left)) { return NaN; }
	switch(Node.operator)
	{
		case "+": return Left + Right;
		case "-": return Left - Right;
		case "*": return Left * Right;
		case "/": return Left / Right;
		default: return Left ** Right;
	}
}

export function sample_plot(Spec: PlotSpec, Values?: Record<string, number>, Count: number = 257): { x: number; y: number | null }[]
{
	if(!Number.isInteger(Count) || Count < 2 || Count > MaxSamples) { return invalid("采样数量须为 2 到 1025 的整数"); }
	const Checked = checked(Spec), Parameters = parameter_values(Checked.spec, Values), X = Checked.spec.x;
	return Array.from({ length: Count }, (_, Index) =>
	{
		const Point = Index === Count - 1 ? X.max : X.min + (X.max - X.min) * Index / (Count - 1);
		const Y = evaluate(Checked.tree, Point, Parameters);
		return { x: Point, y: Number.isFinite(Y) ? Y : null };
	});
}
