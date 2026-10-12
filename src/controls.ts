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

export interface TokenUsage
{
	last: { totalTokens: number; inputTokens: number; outputTokens: number };
	total: { totalTokens: number };
	modelContextWindow: number | null;
}

export function selected_model(Settings: RunSettings, Models: ModelInfo[]): ModelInfo | undefined
{
	return Models.find(Value => Value.model === Settings.Model);
}

export function initial_selection(Settings: RunSettings, Models: ModelInfo[]): RunSettings
{
	const ModelName = Settings.Model || Models.find(Value => Value.isDefault)?.model || Models[0]?.model || "";
	const Model = Models.find(Value => Value.model === ModelName);
	return { Model: ModelName, Effort: Settings.Effort || Model?.defaultReasoningEffort || Model?.supportedReasoningEfforts[0]?.reasoningEffort || "", Fast: Settings.Fast };
}

export function fast_tier(Model: ModelInfo | undefined): string | null
{
	return Model?.serviceTiers?.find(Value => /^(fast|priority)$/i.test(Value.id) || /^fast$/i.test(Value.name))?.id
		?? (Model?.additionalSpeedTiers?.includes("fast") ? "priority" : null);
}

export function run_options(Settings: RunSettings, Models: ModelInfo[]): { model: string; effort: string; serviceTier: string; summary: "auto" }
{
	const Model = selected_model(Settings, Models);
	if(!Model)
	{
		throw new Error("所选模型当前不可用, 请等待模型列表加载或重新选择模型");
	}
	const Effort = Settings.Effort;
	if(!Effort || !Model.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Effort))
	{
		throw new Error(`${Model.displayName} 不支持思考档次 ${Effort}, 请重新选择`);
	}
	const FastTier = fast_tier(Model);
	if(Settings.Fast && !FastTier)
	{
		throw new Error("当前模型未报告 Fast 支持, 请关闭 Fast 或选择其他模型");
	}
	return { model: Model.model, effort: Effort, serviceTier: Settings.Fast ? FastTier! : "default", summary: "auto" };
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
