import { google_reasoning } from "./google-reasoning";

export const ApiProviders = {
	openai: { Label: "OpenAI", Base: "https://api.openai.com/v1", Format: "responses" },
	deepseek: { Label: "DeepSeek", Base: "https://api.deepseek.com", Format: "chat" },
	opencode: { Label: "OpenCode Go", Base: "https://opencode.ai/inference/go/openai/v1", Format: "chat" },
	google: { Label: "Google AI Studio", Base: "https://generativelanguage.googleapis.com/v1beta/openai", Format: "chat" },
	compatible: { Label: "自定义 OpenAI 兼容", Base: "", Format: "chat" }
} as const;
export const AgentNames = { claude: "Claude Code", antigravity: "Antigravity", dsh: "DeepSeek Harness" } as const;
export type ApiProvider = keyof typeof ApiProviders;
export type LocalAgent = keyof typeof AgentNames;
export interface ApiReasoning
{
	Format: "chat" | "responses" | "gemini-level";
	Efforts: string[];
}
export type ApiProtocol = "chat" | "responses";
export interface ApiCatalogModel { Id: string; Protocol?: ApiProtocol; Reasoning?: ApiReasoning; Vision?: boolean; ContextWindow?: number; }
export interface ApiModelSelection
{
	Provider: ApiProvider;
	Base: string;
	Model: string;
	Vision: { Catalog?: boolean; Manual?: boolean };
	Protocol: { Value: ApiProtocol; Source: "catalog" | "manual" | "provider" | "legacy" };
	Reasoning?: ApiReasoning;
}
export type BackendProfile =
	| { Kind: "api"; Provider: ApiProvider; Base: string; Model: string; Vision: boolean; Protocol?: ApiProtocol; Selection?: ApiModelSelection; Identity?: string; Stream?: "auto" | "buffered"; HistoryTools?: boolean }
	| { Kind: "agent"; Agent: LocalAgent; Path: string; Model: string };
export type ApiProfile = Extract<BackendProfile, { Kind: "api" }>;
export type ApiCredentialScope = Pick<ApiProfile, "Kind" | "Provider" | "Base" | "Identity">;

export function valid_backend_model_id(Value: unknown): Value is string
{
	return typeof Value === "string" && /^[a-z0-9][a-z0-9._/:+@-]{0,159}$/i.test(Value);
}

export function api_base(Provider: ApiProvider, CustomBase: string): string
{
	let Url: URL;
	try { Url = new URL(Provider === "compatible" ? CustomBase.trim() : ApiProviders[Provider].Base); }
	catch { throw new Error("请填写有效的 HTTPS API 基础地址"); }
	if(Url.protocol !== "https:" || Url.username || Url.password || Url.search || Url.hash || /\/(responses|chat\/completions)\/?$/i.test(Url.pathname))
	{
		throw new Error("请填写 HTTPS 基础地址, 不带密钥、查询参数或请求末尾路径");
	}
	return Url.href.replace(/\/+$/, "");
}

export function backend_profile(Value: unknown): BackendProfile
{
	const Input = Value as Partial<{ Kind: "api" | "agent"; Provider: ApiProvider; Agent: LocalAgent; Base: string; Path: string; Model: string; Vision: boolean; Protocol: ApiProtocol; Identity: string; Stream: "auto" | "buffered"; HistoryTools: boolean }>;
	if(!Input || typeof Input.Model !== "string") { throw new Error("请填写模型 ID"); }
	const Model = Input.Model.trim();
	if(Model && !valid_backend_model_id(Model)) { throw new Error("模型 ID 格式无效"); }
	if(Input.Kind === "agent" && Input.Agent && Object.hasOwn(AgentNames, Input.Agent))
	{
		const Path = typeof Input.Path === "string" ? Input.Path.trim() : "";
		if(Path && !/^[a-z]:[\\/][^\u0000-\u001f"]+\.(exe|mjs|cjs|js)$/i.test(Path)) { throw new Error("请选择 Windows CLI 的绝对 .exe 或 Node 入口路径"); }
		if(Input.Agent === "dsh" && Model) { throw new Error("DeepSeek Harness 从自己的 headless 配置选择模型, 请留空"); }
		return { Kind: "agent", Agent: Input.Agent, Path, Model };
	}
	if(Input.Kind !== "api" || !Input.Provider || !Object.hasOwn(ApiProviders, Input.Provider) || !Model) { throw new Error("请选择 API 服务商并填写模型 ID"); }
	if(Input.Protocol !== undefined && !["chat", "responses"].includes(Input.Protocol)) { throw new Error("未知 API 请求协议"); }
	if(Input.Stream !== undefined && !["auto", "buffered"].includes(Input.Stream)) { throw new Error("未知 API 传输模式"); }
	const Identity = Input.Identity?.trim();
	if(Identity !== undefined && (!Identity || Identity.length > 80 || /[\u0000-\u001f]/.test(Identity))) { throw new Error("身份标签无效"); }
	const Profile: ApiProfile = { Kind: "api", Provider: Input.Provider, Base: api_base(Input.Provider, typeof Input.Base === "string" ? Input.Base : ""), Model, Vision: Input.Vision === true,
		...(Input.Protocol ? { Protocol: Input.Protocol } : {}), ...(Identity && Identity !== "default" ? { Identity } : {}), ...(Input.Stream ? { Stream: Input.Stream } : {}), ...(typeof Input.HistoryTools==="boolean"?{HistoryTools:Input.HistoryTools}:{}) };
	const Raw = (Value as ApiProfile).Selection;
	if(Raw !== undefined)
	{
		const Selection = clean_selection(Raw, Profile);
		// A spread followed by a model/endpoint edit must never retain another model's confirmation.
		Profile.Vision = false; delete Profile.Protocol;
		if(Selection)
		{
			Profile.Selection = Selection;
			Profile.Vision = selection_images(Selection) === true;
			Profile.Protocol = Selection.Protocol.Value;
		}
	}
	return Profile;
}

export function clean_api_reasoning(Value: unknown): ApiReasoning | undefined
{
	const Input = Value as ApiReasoning | undefined;
	if(!Input || !["chat", "responses", "gemini-level"].includes(Input.Format) || !Array.isArray(Input.Efforts) || !Input.Efforts.length || Input.Efforts.length > 32 || Input.Efforts.some(E => typeof E !== "string" || !/^[a-z]{1,20}$/.test(E))) { return; }
	return { Format: Input.Format, Efforts: [...new Set(Input.Efforts)] };
}

function clean_selection(Input: ApiModelSelection, Profile: ApiProfile): ApiModelSelection | undefined
{
	if(!Input || Input.Provider !== Profile.Provider || Input.Base !== Profile.Base || Input.Model !== Profile.Model || !Input.Vision || !Input.Protocol || !["chat", "responses"].includes(Input.Protocol.Value) || !["catalog", "manual", "provider", "legacy"].includes(Input.Protocol.Source)) { return; }
	const Reasoning = clean_api_reasoning(Input.Reasoning);
	return { Provider: Profile.Provider, Base: Profile.Base, Model: Profile.Model,
		Vision: { ...(typeof Input.Vision.Catalog === "boolean" ? { Catalog: Input.Vision.Catalog } : {}), ...(typeof Input.Vision.Manual === "boolean" ? { Manual: Input.Vision.Manual } : {}) },
		Protocol: { Value: Input.Protocol.Value, Source: Input.Protocol.Source }, ...(Reasoning && reasoning_protocol(Reasoning) === Input.Protocol.Value ? { Reasoning } : {}) };
}

export function selection_images(Selection: ApiModelSelection): true | false | "unknown"
{
	const { Catalog, Manual } = Selection.Vision;
	if(Catalog === false || Manual === false) { return false; }
	return Catalog === true || Manual === true ? true : "unknown";
}

function reasoning_protocol(Reasoning: ApiReasoning): ApiProtocol { return Reasoning.Format === "responses" ? "responses" : "chat"; }

export interface ApiSelectionOverrides { Vision?: boolean | "unknown"; Protocol?: ApiProtocol | "auto"; Reasoning?: ApiReasoning; }
export interface ApiSelection { Profile: ApiProfile; Effort: string; Images: true | false | "unknown"; Reasoning?: ApiReasoning; }

// Catalog undefined retains this model's last evidence; [] is an authoritative empty refresh.
export function select_api_model(Input: ApiProfile, Model: string, Catalog?: readonly ApiCatalogModel[], Effort = "", Overrides: ApiSelectionOverrides = {}): ApiSelection
{
	const Current = backend_profile(Input) as ApiProfile;
	const Previous = Current.Model === Model.trim() ? Current.Selection : undefined;
	const Entry = Catalog?.find(M => M.Id === Model.trim());
	const Vision = { ...(Catalog === undefined ? Previous?.Vision : typeof Entry?.Vision === "boolean" ? { Catalog: Entry.Vision } : {}), ...(Previous?.Vision.Manual !== undefined ? { Manual: Previous.Vision.Manual } : {}) };
	if(Overrides.Vision === "unknown") { delete Vision.Manual; }
	else if(typeof Overrides.Vision === "boolean") { Vision.Manual = Overrides.Vision; }
	const ManualProtocol = Overrides.Protocol === "auto" ? undefined : Overrides.Protocol ?? (Previous?.Protocol.Source === "manual" ? Previous.Protocol.Value : undefined);
	const Protocol: ApiModelSelection["Protocol"] = ManualProtocol ? { Value: ManualProtocol, Source: "manual" }
		: Entry?.Protocol || Entry?.Reasoning ? { Value: Entry.Protocol ?? reasoning_protocol(Entry.Reasoning!), Source: "catalog" }
		: Catalog === undefined && Previous && !(Overrides.Protocol === "auto" && ["manual", "legacy"].includes(Previous.Protocol.Source)) ? Previous.Protocol
		: Overrides.Protocol !== "auto" && !Current.Selection && Current.Model === Model.trim() && Current.Protocol ? { Value: Current.Protocol, Source: "legacy" }
		: { Value: ApiProviders[Current.Provider].Format, Source: "provider" };
	const CandidateReasoning = clean_api_reasoning(Overrides.Reasoning ?? Entry?.Reasoning ?? (Current.Provider === "google" ? google_reasoning(Model) : undefined) ?? (Catalog === undefined ? Previous?.Reasoning : undefined));
	const Reasoning = CandidateReasoning && reasoning_protocol(CandidateReasoning) === Protocol.Value ? CandidateReasoning : undefined;
	const Selection: ApiModelSelection = { Provider: Current.Provider, Base: Current.Base, Model: Model.trim(), Vision, Protocol, ...(Reasoning ? { Reasoning } : {}) };
	const Profile = backend_profile({ ...Current, Model, Selection }) as ApiProfile;
	return { Profile, Images: selection_images(Selection), Effort: Reasoning?.Efforts.includes(Effort) ? Effort : "", ...(Reasoning ? { Reasoning } : {}) };
}

export function api_image_status(Profile: ApiProfile): string
{
	const Selection = Profile.Selection;
	if(!Selection)
	{
		return Profile.Vision ? "沿用当前服务商、端点和模型的旧图片开启设置，可按原设置发送；能力依据未知，未补记人工或目录确认。"
			: "旧图片设置为关闭；能力依据未知。可明确开启当前模型的图片输入，或选择目录已声明支持的模型。";
	}
	const { Catalog, Manual } = Selection.Vision;
	if(Catalog === false) { return Manual === true ? "目录明确不支持图片，人工确认不能覆盖。请选择支持图片的模型；附件保留。" : "目录明确不支持图片。请选择支持图片的模型，或自行移除图片；附件保留。"; }
	if(Manual === false) { return "已对当前模型禁用图片。可在设置中重新确认，或选择支持图片的模型；附件保留。"; }
	if(Catalog === true) { return "目录明确支持图片。"; }
	if(Manual === true) { return "已人工确认此服务商、端点和模型支持图片，目录尚未声明。"; }
	return "目录未声明图片能力。请在设置中确认当前模型，或切换到明确支持图片的模型；附件保留。";
}

export function backend_name(Profile: BackendProfile): string
{
	return Profile.Kind === "api" ? ApiProviders[Profile.Provider].Label : AgentNames[Profile.Agent];
}

export function backend_identity(Profile: ApiCredentialScope | Pick<Extract<BackendProfile, { Kind: "agent" }>, "Kind" | "Agent" | "Path">): string
{
	return JSON.stringify(Profile.Kind === "api" ? [Profile.Provider, Profile.Base, ...(Profile.Identity ? [Profile.Identity] : [])] : [Profile.Agent, Profile.Path.toLowerCase()]);
}

export function backend_model(Profile: BackendProfile): string { return Profile.Model || `${Profile.Kind === "agent" ? Profile.Agent : Profile.Provider}-default`; }

export function api_reasoning_supported(Provider: ApiProvider): boolean
{
	return Provider === "opencode" || Provider === "deepseek" || Provider === "google";
}
