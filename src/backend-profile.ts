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
export type BackendProfile =
	| { Kind: "api"; Provider: ApiProvider; Base: string; Model: string; Vision: boolean }
	| { Kind: "agent"; Agent: LocalAgent; Path: string; Model: string };

export function backend_profile(Value: unknown): BackendProfile
{
	const Input = Value as Partial<{ Kind: "api" | "agent"; Provider: ApiProvider; Agent: LocalAgent; Base: string; Path: string; Model: string; Vision: boolean }>;
	if(!Input || typeof Input.Model !== "string") { throw new Error("请填写模型 ID"); }
	const Model = Input.Model.trim();
	if(Model && !/^[a-z0-9][a-z0-9._/:+@-]{0,159}$/i.test(Model)) { throw new Error("模型 ID 格式无效"); }
	if(Input.Kind === "agent" && Input.Agent && Object.hasOwn(AgentNames, Input.Agent))
	{
		const Path = typeof Input.Path === "string" ? Input.Path.trim() : "";
		if(Path && !/^[a-z]:[\\/][^\u0000-\u001f"]+\.(exe|mjs|cjs|js)$/i.test(Path)) { throw new Error("请选择 Windows CLI 的绝对 .exe 或 Node 入口路径"); }
		if(Input.Agent === "dsh" && Model) { throw new Error("DeepSeek Harness 从自己的 headless 配置选择模型, 请留空"); }
		return { Kind: "agent", Agent: Input.Agent, Path, Model };
	}
	if(Input.Kind !== "api" || !Input.Provider || !Object.hasOwn(ApiProviders, Input.Provider) || !Model) { throw new Error("请选择 API 服务商并填写模型 ID"); }
	const Base = Input.Provider === "compatible" ? typeof Input.Base === "string" ? Input.Base.trim() : "" : ApiProviders[Input.Provider].Base;
	let Url: URL;
	try { Url = new URL(Base ?? ""); } catch { throw new Error("请填写有效的 HTTPS API 基础地址"); }
	if(Url.protocol !== "https:" || Url.username || Url.password || Url.search || Url.hash || /\/(responses|chat\/completions)\/?$/i.test(Url.pathname))
	{
		throw new Error("请填写 HTTPS 基础地址, 不带密钥、查询参数或请求末尾路径");
	}
	return { Kind: "api", Provider: Input.Provider, Base: Url.href.replace(/\/+$/, ""), Model, Vision: Input.Vision === true };
}

export function backend_name(Profile: BackendProfile): string
{
	return Profile.Kind === "api" ? ApiProviders[Profile.Provider].Label : AgentNames[Profile.Agent];
}

export function backend_identity(Profile: BackendProfile): string
{
	return JSON.stringify(Profile.Kind === "api" ? [Profile.Provider, Profile.Base] : [Profile.Agent, Profile.Path.toLowerCase()]);
}

export function backend_model(Profile: BackendProfile): string { return Profile.Model || `${Profile.Kind === "agent" ? Profile.Agent : Profile.Provider}-default`; }
