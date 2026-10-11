import { test } from "node:test";
import assert from "node:assert/strict";
import { run_options, context_usage, fast_tier, type ModelInfo } from "../src/controls";

const Models: ModelInfo[] = [
	{ model: "model-a", displayName: "Model A", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "high", description: "" }], defaultReasoningEffort: "low", serviceTiers: [{ id: "priority", name: "Fast", description: "" }], isDefault: true },
	{ model: "model-b", displayName: "Model B", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }], defaultReasoningEffort: "medium", serviceTiers: [], isDefault: false }
];
const Defaults = { Model: "model-a", Effort: "high" };

test("native defaults and model defaults differ; reverting options resets sticky thread overrides", () =>
{
	assert.deepEqual(run_options({ Model: "", Effort: "", Fast: false }, Models, Defaults), { model: "model-a", effort: "high", serviceTier: "default", summary: "auto" });
	assert.deepEqual(run_options({ Model: "model-b", Effort: "", Fast: false }, Models, Defaults), { model: "model-b", effort: "medium", serviceTier: "default", summary: "auto" });
	assert.equal(run_options({ Model: "model-a", Effort: "low", Fast: true }, Models, Defaults).serviceTier, "priority");
	assert.equal(run_options({ Model: "model-a", Effort: "", Fast: false }, Models, Defaults).serviceTier, "default");
});

test("unsupported effort and Fast fail explicitly instead of silently claiming application", () =>
{
	assert.throws(() => run_options({ Model: "model-b", Effort: "high", Fast: false }, Models, Defaults), /不支持思考档次/);
	assert.throws(() => run_options({ Model: "model-b", Effort: "", Fast: true }, Models, Defaults), /未报告 Fast 支持/);
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
