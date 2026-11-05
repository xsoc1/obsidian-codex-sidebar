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
export type BackendProfile =
	| { Kind: "api"; Provider: ApiProvider; Base: string; Model: string; Vision: boolean; Protocol?: ApiProtocol; Identity?: string; Stream?: "auto" | "buffered"; HistoryTools?: boolean }
	| { Kind: "agent"; Agent: LocalAgent; Path: string; Model: string };

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
	return { Kind: "api", Provider: Input.Provider, Base: api_base(Input.Provider, typeof Input.Base === "string" ? Input.Base : ""), Model, Vision: Input.Vision === true,
		...(Input.Protocol ? { Protocol: Input.Protocol } : {}), ...(Identity && Identity !== "default" ? { Identity } : {}), ...(Input.Stream ? { Stream: Input.Stream } : {}), ...(typeof Input.HistoryTools==="boolean"?{HistoryTools:Input.HistoryTools}:{}) };
}

export function backend_name(Profile: BackendProfile): string
{
	return Profile.Kind === "api" ? ApiProviders[Profile.Provider].Label : AgentNames[Profile.Agent];
}

export function backend_identity(Profile: BackendProfile): string
{
	return JSON.stringify(Profile.Kind === "api" ? [Profile.Provider, Profile.Base, ...(Profile.Identity ? [Profile.Identity] : [])] : [Profile.Agent, Profile.Path.toLowerCase()]);
}

export function backend_model(Profile: BackendProfile): string { return Profile.Model || `${Profile.Kind === "agent" ? Profile.Agent : Profile.Provider}-default`; }

export function api_reasoning_supported(Provider: ApiProvider): boolean
{
	return Provider === "opencode" || Provider === "deepseek" || Provider === "google";
}
