export interface ModelInfo
{
	model: string;
	displayName: string;
	supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
	defaultReasoningEffort: string;
	serviceTiers?: { id: string; name: string; description: string }[];
	additionalSpeedTiers?: string[];
	isDefault: boolean;
}

export interface RunSettings
{
	Model: string;
	Effort: string;
	Fast: boolean;
}

export interface RunDefaults
{
	Model: string;
	Effort: string;
}

export interface TokenUsage
{
	last: { totalTokens: number; inputTokens: number; outputTokens: number };
	total: { totalTokens: number };
	modelContextWindow: number | null;
}

export function selected_model(Settings: RunSettings, Models: ModelInfo[], Defaults: RunDefaults): ModelInfo | undefined
{
	return Models.find(Value => Value.model === (Settings.Model || Defaults.Model)) ?? (!Settings.Model ? Models.find(Value => Value.isDefault) : undefined);
}

export function fast_tier(Model: ModelInfo | undefined): string | null
{
	return Model?.serviceTiers?.find(Value => /^(fast|priority)$/i.test(Value.id) || /^fast$/i.test(Value.name))?.id
		?? (Model?.additionalSpeedTiers?.includes("fast") ? "priority" : null);
}

export function run_options(Settings: RunSettings, Models: ModelInfo[], Defaults: RunDefaults): { model?: string; effort?: string; serviceTier: string; summary: "auto" }
{
	const Model = selected_model(Settings, Models, Defaults);
	const ModelName = Settings.Model || Defaults.Model || Model?.model;
	const Effort = Settings.Effort || (!Settings.Model ? Defaults.Effort : "") || Model?.defaultReasoningEffort;
	if(Effort && Model && !Model.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Effort))
	{
		throw new Error(`${Model.displayName} 不支持思考档次 ${Effort}, 请重新选择`);
	}
	const FastTier = fast_tier(Model);
	if(Settings.Fast && !FastTier)
	{
		throw new Error("当前模型未报告 Fast 支持, 请关闭 Fast 或选择其他模型");
	}
	return { ...(ModelName ? { model: ModelName } : {}), ...(Effort ? { effort: Effort } : {}), serviceTier: Settings.Fast ? FastTier! : "default", summary: "auto" };
}

export function context_usage(Usage: TokenUsage | undefined): { Used: number; Window: number | null; Percent: number | null; Total: number } | null
{
	if(!Usage || !Number.isFinite(Usage.last?.totalTokens) || Usage.last.totalTokens < 0)
	{
		return null;
	}
	const Window = typeof Usage.modelContextWindow === "number" && Usage.modelContextWindow > 0 ? Usage.modelContextWindow : null;
	return { Used: Usage.last.totalTokens, Window, Percent: Window ? Math.min(100, Usage.last.totalTokens / Window * 100) : null, Total: Usage.total.totalTokens };
}
