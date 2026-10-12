import { test } from "node:test";
import assert from "node:assert/strict";
import { run_options, initial_selection, context_usage, fast_tier, type ModelInfo } from "../src/controls";

const Models: ModelInfo[] = [
	{ model: "model-a", displayName: "Model A", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "high", description: "" }], defaultReasoningEffort: "low", serviceTiers: [{ id: "priority", name: "Fast", description: "" }], isDefault: true },
	{ model: "model-b", displayName: "Model B", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }], defaultReasoningEffort: "medium", serviceTiers: [], isDefault: false }
];
test("first use initializes a concrete selection; later catalog defaults never replace saved choices", () =>
{
	assert.deepEqual(initial_selection({ Model: "", Effort: "", Fast: false }, Models), { Model: "model-a", Effort: "low", Fast: false });
	const Saved = { Model: "model-a", Effort: "high", Fast: true };
	const Changed = Models.map(Value => ({ ...Value, isDefault: Value.model === "model-b" }));
	assert.deepEqual(initial_selection(Saved, Changed), Saved);
	assert.deepEqual(initial_selection(Saved, []), Saved);
	assert.deepEqual(initial_selection({ ...Saved, Effort: "" }, Models), { ...Saved, Effort: "low" });
});

test("explicit model and effort choices control each request and Fast resets to standard", () =>
{
	assert.deepEqual(run_options({ Model: "model-a", Effort: "high", Fast: false }, Models), { model: "model-a", effort: "high", serviceTier: "default", summary: "auto" });
	assert.deepEqual(run_options({ Model: "model-b", Effort: "medium", Fast: false }, Models), { model: "model-b", effort: "medium", serviceTier: "default", summary: "auto" });
	assert.equal(run_options({ Model: "model-a", Effort: "low", Fast: true }, Models).serviceTier, "priority");
	assert.equal(run_options({ Model: "model-a", Effort: "low", Fast: false }, Models).serviceTier, "default");
});

test("unsupported effort and Fast fail explicitly instead of silently claiming application", () =>
{
	assert.throws(() => run_options({ Model: "model-b", Effort: "high", Fast: false }, Models), /不支持思考档次/);
	assert.throws(() => run_options({ Model: "model-b", Effort: "medium", Fast: true }, Models), /未报告 Fast 支持/);
	assert.throws(() => run_options({ Model: "", Effort: "low", Fast: false }, Models), /模型当前不可用/);
	assert.throws(() => run_options({ Model: "model-a", Effort: "", Fast: false }, Models), /不支持思考档次/);
	assert.equal(fast_tier({ ...Models[0], serviceTiers: [{ id: "fast", name: "Fast", description: "" }] }), "fast");
	assert.equal(fast_tier(undefined), null);
});

test("context occupancy uses the last request, not accumulated consumption; unknown window stays unknown", () =>
{
	const Usage = { last: { totalTokens: 2000, inputTokens: 1700, outputTokens: 300 }, total: { totalTokens: 50000 }, modelContextWindow: 10000 };
	assert.deepEqual(context_usage(Usage), { Used: 2000, Window: 10000, Percent: 20, Total: 50000 });
	assert.equal(context_usage({ ...Usage, modelContextWindow: null })?.Percent, null);
	assert.equal(context_usage(undefined), null);
	assert.equal(context_usage({ ...Usage, last: { ...Usage.last, totalTokens: -1 } }), null);
});
