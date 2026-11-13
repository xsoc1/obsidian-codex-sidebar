import { test } from "node:test";
import assert from "node:assert/strict";
import { plot_values, sample_plot, validate_plot, type PlotSpec } from "../src/interactive/plot";
import { render_plot } from "../src/interactive/plot-view";

function heat(): PlotSpec
{
	return { id: "heat-example", title: "热方程: 衰减的正弦波", expression: "exp(-t)*sin(x)", x: { min: -Math.PI, max: Math.PI }, y: { min: -1.2, max: 1.2 }, parameters: [{ name: "t", label: "时间", min: 0, max: 5, step: 0.1, value: 0 }], caption: "原创示例: u_t = u_xx。" };
}

function formula(Expression: string, Min: number = -1, Max: number = 1): PlotSpec
{
	return { id: "formula", title: "公式核验", expression: Expression, x: { min: Min, max: Max }, parameters: [] };
}

function near(Actual: number | null, Expected: number): void
{
	assert.notEqual(Actual, null); assert.ok(Math.abs(Actual! - Expected) < 1e-12, `${Actual} != ${Expected}`);
}

test("heat sample preserves endpoints and exact amplitude with explicit time", () =>
{
	const Spec = heat(), Initial = sample_plot(Spec, undefined, 5), Later = sample_plot(Spec, { t: 1 }, 5);
	assert.deepEqual(Initial.map(P => P.x), [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]);
	near(Initial[1].y, -1); near(Initial[2].y, 0); near(Initial[3].y, 1);
	near(Later[1].y, -Math.exp(-1)); near(Later[3].y, Math.exp(-1));
	assert.equal(Spec.parameters[0].value, 0);
});

test("bounded grammar implements mathematical precedence, right powers, constants and unary functions", () =>
{
	for(const [Expression, Expected] of [
		["2+3*4", 14], ["(2+3)*4", 20], ["2^3^2", 512], ["-2^2", -4], ["(-2)^2", 4], ["2^-2", 0.25],
		["8/4/2", 1], ["8-4-2", 2], [".5+1e-2+1.", 1.51], ["sin(pi/2)+log(e)", 2],
		["sqrt(9)+abs(-2)+cos(0)+tan(0)", 6], ["asin(1)+acos(0)+atan(1)", 5 * Math.PI / 4], [" + - - 3 ", 3]
	] as const) { near(sample_plot(formula(Expression), undefined, 2)[0].y, Expected); }
});

test("undefined, overflow and intermediate domain failures are explicit null breaks", () =>
{
	assert.deepEqual(sample_plot(formula("1/x"), undefined, 3).map(P => P.y), [-1, null, 1]);
	assert.deepEqual(sample_plot(formula("sqrt(x)"), undefined, 3).map(P => P.y), [null, 0, 1]);
	assert.deepEqual(sample_plot(formula("log(x)"), undefined, 3).map(P => P.y), [null, null, 0]);
	for(const Expression of ["exp(1000)", "1/(1/0)", "0*exp(1000)", "(-1)^.5", "acos(2)", "0/0"])
	{
		assert.ok(sample_plot(formula(Expression)).every(P => P.y === null), Expression);
	}
});

test("parameter snapshots are complete, independently copied, clamped and snapped from min", () =>
{
	const Spec = heat(); Spec.parameters.push({ name: "a", label: "幅值", min: -0.25, max: 0.75, step: 0.1, value: -0.25 });
	Spec.expression = "a*exp(-t)*sin(x)";
	assert.deepEqual(plot_values(Spec), { t: 0, a: -0.25 });
	assert.deepEqual(plot_values(Spec, { t: 0.26 }), { t: 0.3, a: -0.25 });
	assert.deepEqual(plot_values(Spec, { t: -100, a: 100 }), { t: 0, a: 0.75 });
	assert.deepEqual(plot_values(Spec, { t: Number.MAX_VALUE }), { t: 5, a: -0.25 });
	const Input = { t: 1.24 }, Values = plot_values(Spec, Input); Values.a = 0;
	assert.deepEqual(Input, { t: 1.24 }); assert.equal(Spec.parameters[1].value, -0.25);
	Spec.parameters[0].max = 1; Spec.parameters[0].step = 0.3;
	assert.equal(plot_values(Spec, { t: 1 }).t, 0.9);
	Spec.parameters[0].value = 0.26; assert.equal(validate_plot(Spec).parameters[0].value, 0.3);
	const Clean = validate_plot(Spec); Clean.x.min = -100; Clean.parameters[0].value = 0;
	assert.equal(Spec.x.min, -Math.PI); assert.equal(Spec.parameters[0].value, 0.26);
});

test("parameter inputs reject unknown keys, coercion, prototypes and nonfinite values", () =>
{
	for(const Value of [{ x: 1 }, { z: 1 }, { t: NaN }, { t: Infinity }, { t: "1" }, null, [], JSON.parse('{"__proto__":1}'), { constructor: 1 }, Object.create({ t: 1 })])
	{
		assert.throws(() => plot_values(heat(), Value as Record<string, number>));
		assert.throws(() => sample_plot(heat(), Value as Record<string, number>));
	}
	let Read = false;
	const Accessor = Object.defineProperty({}, "t", { get() { Read = true; return 1; } });
	assert.throws(() => plot_values(heat(), Accessor)); assert.equal(Read, false);
	assert.deepEqual(plot_values(heat(), Object.assign(Object.create(null), { t: 1 })), { t: 1 });
});

test("strict nested schema rejects unknown fields, missing values, hostile names and bad bounds", () =>
{
	const Cases: unknown[] = [null, [], "plot", {}, { ...heat(), script: "alert(1)" }, { ...heat(), id: "../plot" }, { ...heat(), id: "__proto__" }, { ...heat(), title: "" }, { ...heat(), title: "a".repeat(121) }, { ...heat(), caption: "a".repeat(501) }, { ...heat(), title: "\u0000" }, { ...heat(), y: undefined }, { ...heat(), caption: undefined }];
	for(const Range of [{ min: 1, max: 1 }, { min: 2, max: 1 }, { min: 0, max: Infinity }, { min: -1e7, max: 0 }, { min: 0, max: 1e-10 }, { min: 0, max: 1, extra: true }])
	{
		Cases.push({ ...heat(), x: Range }, { ...heat(), y: Range });
	}
	for(const Name of ["x", "pi", "e", "sin", "__proto__", "constructor", "prototype", "toString", "a.b", "a b", "a".repeat(33)])
	{
		const Spec = heat(); Spec.parameters[0].name = Name; Cases.push(Spec);
	}
	for(const Patch of [{ min: NaN }, { max: -1 }, { step: 0 }, { step: -1 }, { step: Infinity }, { step: 6 }, { step: 1e-8 }, { value: 6 }, { value: NaN }, { label: "" }, { extra: true }])
	{
		const Spec = heat(); Object.assign(Spec.parameters[0], Patch); Cases.push(Spec);
	}
	const Duplicate = heat(); Duplicate.parameters.push({ ...Duplicate.parameters[0] }); Cases.push(Duplicate);
	const TooMany = heat(); TooMany.parameters = Array.from({ length: 5 }, (_, Index) => ({ ...TooMany.parameters[0], name: "a" + Index })); Cases.push(TooMany);
	const Sparse = heat(); Sparse.parameters = Array(1); Cases.push(Sparse);
	const Extra = heat(); Object.assign(Extra.parameters, { other: 1 }); Cases.push(Extra);
	const SymbolKey = heat(); Object.assign(SymbolKey, { [Symbol("bad")]: true }); Cases.push(SymbolKey);
	for(const Value of Cases) { assert.throws(() => validate_plot(Value), JSON.stringify(Value)); }
	const Four = heat(); Four.parameters = Array.from({ length: 4 }, (_, Index) => ({ ...Four.parameters[0], name: "a" + Index })); Four.expression = "a0+a1+a2+a3+x";
	assert.equal(validate_plot(Four).parameters.length, 4);
	let Read = false;
	const Accessor = Object.defineProperty(heat(), "title", { get() { Read = true; return "bad"; } });
	assert.throws(() => validate_plot(Accessor)); assert.equal(Read, false);
	const ArrayAccessor = heat(); Object.defineProperty(ArrayAccessor.parameters, "0", { get() { Read = true; return heat().parameters[0]; } });
	assert.throws(() => validate_plot(ArrayAccessor)); assert.equal(Read, false);
});

test("expressions cannot escape into JavaScript, property access, implicit multiplication or unknown names", () =>
{
	for(const Expression of ["", " ", "Math.sin(x)", "window", "process.exit()", "fetch('https://example.org')", "Function(x)", "eval(x)", "x.constructor", "x['constructor']", "__proto__", "constructor", "globalThis", "x=1", "x;1", "(()=>1)()", "new Date()", "[x]", "{x}", "`x`", "x?1:0", "x||1", "x**2", "x%2", "1//2", "2x", "sin x", "sin()", "sin(x,1)", "min(1,2)", "x+y", "x x", "()", "(x", "x)", "1e999", "NaN", "Infinity", "π", "x+", "/*x*/1"])
	{
		assert.throws(() => validate_plot(formula(Expression)), Expression);
	}
});

test("length, tokens, AST depth, parenthesis depth and sampling have fixed budgets", () =>
{
	assert.equal(sample_plot(heat()).length, 257); assert.equal(sample_plot(heat(), undefined, 1025).length, 1025);
	for(const Count of [0, 1, -1, 2.5, 1026, 1e9, NaN, Infinity]) { assert.throws(() => sample_plot(heat(), undefined, Count)); }
	assert.throws(() => validate_plot(formula("1".repeat(513))));
	assert.throws(() => validate_plot(formula("(".repeat(33) + "x" + ")".repeat(33))));
	assert.throws(() => validate_plot(formula("-".repeat(33) + "x")));
	assert.throws(() => validate_plot(formula(Array(34).fill("x").join("+"))));
	assert.throws(() => validate_plot(formula("-".repeat(257) + "x")));
	const Balanced = (Depth: number): string => Depth ? "(" + Balanced(Depth - 1) + "+" + Balanced(Depth - 1) + ")" : "x";
	assert.equal(sample_plot(formula(Balanced(5)), undefined, 2)[1].y, 32);
	assert.throws(() => validate_plot(formula(Balanced(6) + "+x+x")), /token/);
});

class Element
{
	children: Element[] = [];
	parentElement: Element | null = null;
	className = "";
	textContent = "";
	value = "";
	type = "";
	min = "";
	max = "";
	step = "";
	id = "";
	htmlFor = "";
	disabled = false;
	Attributes = new Map<string, string>();
	Listeners = new Map<string, Set<() => void>>();
	classList = { add: (Name: string) => { this.className += (this.className ? " " : "") + Name; } };
	ownerDocument = { createElement: (Tag: string) => new Element(Tag), createElementNS: (_Namespace: string, Tag: string) => new Element(Tag) };
	constructor(readonly Tag: string = "div") {}
	setAttribute(Key: string, Value: string): void { this.Attributes.set(Key, Value); if(Key === "class") { this.className = Value; } }
	appendChild(Child: Element): Element { this.children.push(Child); Child.parentElement = this; return Child; }
	addEventListener(Name: string, Listener: () => void): void { if(!this.Listeners.has(Name)) { this.Listeners.set(Name, new Set()); } this.Listeners.get(Name)!.add(Listener); }
	removeEventListener(Name: string, Listener: () => void): void { this.Listeners.get(Name)?.delete(Listener); }
	fire(Name: string): void { for(const Listener of this.Listeners.get(Name) ?? []) { Listener(); } }
	remove(): void { if(this.parentElement) { this.parentElement.children = this.parentElement.children.filter(Child => Child !== this); this.parentElement = null; } }
	all(): Element[] { return [this, ...this.children.flatMap(Child => Child.all())]; }
	all_text(): string { return this.textContent + this.children.map(Child => Child.all_text()).join("\n"); }
}

test("DOM sliders update existing SVG/labels, emit copied parameter state, reset and dispose without side effects", () =>
{
	const Parent = new Element(), Changes: Record<string, number>[] = [], Spec = heat();
	const View = render_plot(Parent as unknown as HTMLElement, Spec, { t: 1 }, Values => { Changes.push({ ...Values }); Values.t = 5; });
	const Nodes = Parent.all(), Input = Nodes.find(E => E.Tag === "input")!, Path = Nodes.find(E => E.Tag === "path")!, Output = Nodes.find(E => E.Tag === "output")!, Reset = Nodes.find(E => E.Tag === "button")!, Chart = Nodes.find(E => E.Tag === "svg")!;
	assert.equal(Input.value, "1"); assert.equal(Input.min, "0"); assert.equal(Input.max, "5"); assert.equal(Input.step, "0.1"); assert.equal(Reset.disabled, false);
	assert.equal(Nodes.find(E => E.Tag === "label")!.htmlFor, Input.id); assert.match(Input.id, /^codex-plot-/);
	assert.match(Chart.Attributes.get("aria-label")!, /exp\(-t\)\*sin\(x\)/); assert.match(Parent.all_text(), /有限采样/); assert.match(Parent.all_text(), /原创示例/); assert.equal(Changes.length, 0);
	const Original = Path.Attributes.get("d"); Input.value = "2.24"; Input.fire("input");
	assert.equal(Input.value, "2.2"); assert.equal(Output.textContent, "2.2"); assert.deepEqual(View.values(), { t: 2.2 }); assert.deepEqual(Changes, [{ t: 2.2 }]);
	assert.notEqual(Path.Attributes.get("d"), Original); assert.deepEqual(Parent.all(), Nodes);
	const Snapshot = View.values(); Snapshot.t = 99; assert.deepEqual(View.values(), { t: 2.2 });
	Input.fire("input"); assert.equal(Changes.length, 1);
	Reset.fire("click"); assert.deepEqual(View.values(), { t: 0 }); assert.equal(Output.textContent, "0"); assert.equal(Reset.disabled, true); assert.equal(Changes.length, 2);
	assert.ok(Nodes.every(E => !E.Attributes.has("title"))); assert.ok(Nodes.every(E => !E.className || E.className.split(" ").every(C => C.startsWith("codex-plot"))));
	View.dispose(); View.dispose(); Input.value = "4"; Input.fire("input"); Reset.fire("click");
	assert.equal(Parent.children.length, 0); assert.equal(Changes.length, 2); assert.deepEqual(View.values(), { t: 0 });
});

test("DOM renders safe text, clipped/no-domain states, and separate paths around breaks", () =>
{
	const Parent = new Element(), Spec = formula("1/x"); Spec.title = "<img src=x onerror=alert(1)>"; Spec.caption = "<script>unsafe</script>";
	const View = render_plot(Parent as unknown as HTMLElement, Spec, undefined, () => assert.fail("not an inference or initial callback"));
	const Nodes = Parent.all(), Data = Nodes.find(E => E.Tag === "path")!.Attributes.get("d")!;
	assert.equal((Data.match(/M/g) ?? []).length, 2); assert.ok(!/NaN|Infinity/.test(Data)); assert.match(Parent.all_text(), /1 个采样断点/);
	assert.ok(Nodes.every(E => E.Tag !== "script" && E.Tag !== "img")); assert.ok(Nodes.find(E => E.className === "codex-plot-title")!.textContent.startsWith("<img")); View.dispose();
	for(const Expression of ["log(-1)", "1e308"])
	{
		const Root = new Element(); render_plot(Root as unknown as HTMLElement, formula(Expression), undefined, () => {});
		assert.match(Root.all_text(), Expression === "log(-1)" ? /当前采样均无定义/ : /超出纵轴/);
		assert.ok(!/NaN|Infinity/.test(Root.all().find(E => E.Tag === "path")!.Attributes.get("d")!));
	}
});

test("late input and reset cannot mutate a cached plot after its session is inactive", () =>
{
	const Parent = new Element(), Changes: unknown[] = []; let Active = true;
	const View = render_plot(Parent as unknown as HTMLElement, heat(), { t: 2 }, V => Changes.push(V), () => Active);
	const Nodes = Parent.all(), Input = Nodes.find(E => E.Tag === "input")!, Path = Nodes.find(E => E.Tag === "path")!, Reset = Nodes.find(E => E.Tag === "button")!, Original = Path.Attributes.get("d");
	Active = false; Input.value = "4"; Input.fire("input"); Reset.fire("click");
	assert.deepEqual(View.values(), { t: 2 }); assert.equal(Input.value, "2"); assert.equal(Path.Attributes.get("d"), Original); assert.equal(Changes.length, 0);
	Active = true; Input.value = "3"; Input.fire("input"); assert.deepEqual(View.values(), { t: 3 }); assert.equal(Changes.length, 1); View.dispose();
});

test("invalid render data fails before attaching DOM or calling Changed", () =>
{
	const Parent = new Element();
	assert.throws(() => render_plot(Parent as unknown as HTMLElement, heat(), { invalid: 1 }, () => assert.fail()));
	assert.throws(() => render_plot(Parent as unknown as HTMLElement, formula("alert(x)"), undefined, () => assert.fail()));
	assert.equal(Parent.children.length, 0);
});

test("automatic axes stay fixed during decay and multiple cards have distinct accessible slider IDs", () =>
{
	const Parent = new Element(), Spec = heat(); delete Spec.y;
	const First = render_plot(Parent as unknown as HTMLElement, Spec, undefined, () => {});
	const Nodes = Parent.all(), Input = Nodes.find(E => E.Tag === "input")!, Labels = Nodes.filter(E => E.Tag === "text").map(E => E.textContent), Path = Nodes.find(E => E.Tag === "path")!, Before = Path.Attributes.get("d");
	Input.value = "5"; Input.fire("input");
	assert.deepEqual(Parent.all().filter(E => E.Tag === "text").map(E => E.textContent), Labels); assert.notEqual(Path.Attributes.get("d"), Before);
	const Second = render_plot(Parent as unknown as HTMLElement, Spec, { t: 1 }, () => {});
	const Ids = Parent.all().filter(E => E.Tag === "input").map(E => E.id); assert.equal(new Set(Ids).size, 2);
	First.dispose(); assert.deepEqual(Second.values(), { t: 1 }); assert.equal(Parent.children.length, 1); Second.dispose();
});
