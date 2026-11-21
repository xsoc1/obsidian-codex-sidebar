export interface ModelInfo
{
	model: string;
	displayName: string;
	supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
	defaultReasoningEffort: string;
	serviceTiers?: { id: string; name: string; description: string }[];
	additionalSpeedTiers?: string[];
	isDefault: boolean;
	inputModalities?: string[];
}

export interface RunSettings
{
	Model: string;
	Effort: string;
	Fast: boolean;
	// Fast remains the legacy on/off representation; Ultrafast is never encoded as Fast.
	Speed?: "ultrafast";
}

export type RunSpeed = "default" | "fast" | "ultrafast";

export function run_speed(Settings: Pick<RunSettings, "Fast" | "Speed">): RunSpeed
{
	return Settings.Speed === "ultrafast" ? "ultrafast" : Settings.Fast ? "fast" : "default";
}

export function wire_speed(Tier: unknown): RunSpeed
{
	if(Tier === undefined || Tier === null || Tier === "default") { return "default"; }
	if(Tier === "priority" || Tier === "fast") { return "fast"; }
	if(Tier === "ultrafast") { return "ultrafast"; }
	throw new Error("不支持此 Codex 速度档位, 未提交推理");
}

export function speed_label(Speed: RunSpeed): string
{
	return Speed === "ultrafast" ? "Ultrafast" : Speed === "fast" ? "Fast" : "标准";
}

export function tier_label(Tier: string | undefined): string
{
	if(Tier === "ultrafast") { return "Ultrafast"; }
	return Tier === "priority" || Tier === "fast" ? "Fast" : "";
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
	return { Model: ModelName, Effort: Settings.Effort || Model?.defaultReasoningEffort || Model?.supportedReasoningEfforts[0]?.reasoningEffort || "", Fast: Settings.Fast, ...(Settings.Speed === "ultrafast" ? { Speed: Settings.Speed } : {}) };
}

export function fast_tier(Model: ModelInfo | undefined): string | null
{
	return Model?.serviceTiers?.find(Value => /^(fast|priority)$/i.test(Value.id) || Value.id !== "ultrafast" && /^fast$/i.test(Value.name))?.id
		?? (Model?.additionalSpeedTiers?.includes("fast") ? "priority" : null);
}

export function speed_options(Model: ModelInfo | undefined, AllowUltra: boolean): RunSpeed[]
{
	const Options: RunSpeed[] = ["default"];
	if(fast_tier(Model)) { Options.push("fast"); }
	if(AllowUltra && (Model?.serviceTiers?.some(Tier => Tier.id === "ultrafast") ||
		(!Model?.serviceTiers?.length && Model?.additionalSpeedTiers?.includes("ultrafast")))) { Options.push("ultrafast"); }
	return Options;
}

export function run_options(Settings: RunSettings, Models: ModelInfo[], AllowUltra = true): { model: string; effort: string; serviceTier: string; summary: "auto" }
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
	const Speed = run_speed(Settings);
	if(Speed === "ultrafast" && !AllowUltra)
	{
		throw new Error("当前 Windows 独立桥未确认支持 Ultrafast, 请升级桥后重连, 或明确选择其他速度; 未提交推理");
	}
	if(!speed_options(Model, AllowUltra).includes(Speed))
	{
		throw new Error(`当前模型未报告 ${speed_label(Speed)} 支持, 请选择标准速度或其他模型`);
	}
	return { model: Model.model, effort: Effort, serviceTier: Speed === "fast" ? fast_tier(Model)! : Speed, summary: "auto" };
}

export function bridge_run_options(Model: string, Effort: string, Tier: unknown, Models: ModelInfo[]): ReturnType<typeof run_options>
{
	const Speed = wire_speed(Tier);
	return run_options({ Model, Effort, Fast: Speed === "fast", ...(Speed === "ultrafast" ? { Speed } : {}) }, Models);
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
