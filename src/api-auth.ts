export const ApiKeyEndpoint = "https://api.openai.com/v1";

export function openai_api_key(Value: string): string
{
	const Key = Value.trim();
	if(!/^sk-[a-zA-Z0-9_-]{16,509}$/.test(Key))
	{
		throw new Error("请输入有效格式的 OpenAI API Key");
	}
	return Key;
}

export async function authenticate_api_key(Connection: { request(Method: string, Params: unknown): Promise<any> }, Cwd: string, Key: string): Promise<void>
{
	const { config: Config } = await Connection.request("config/read", { cwd: Cwd, includeLayers: false });
	const { requirements: Requirements } = await Connection.request("configRequirements/read", {});
	if(Config?.cli_auth_credentials_store !== "ephemeral" || Config.model_provider !== "openai" || Config.openai_base_url !== ApiKeyEndpoint ||
		Requirements?.cliAuthCredentialsStore != null && Requirements.cliAuthCredentialsStore !== "ephemeral")
	{
		throw new Error("当前 Codex CLI 未启用安全的临时 API Key 模式, 请检查 CLI 版本和管理员策略");
	}
	if(Config.forced_login_method === "chatgpt" || Array.isArray(Requirements?.allowedLoginMethods) && !Requirements.allowedLoginMethods.includes("api"))
	{
		throw new Error("当前 Codex 登录策略不允许 API Key");
	}
	try
	{
		const Login = await Connection.request("account/login/start", { type: "apiKey", apiKey: Key });
		const Account = await Connection.request("account/read", { refreshToken: false });
		if(Login.type === "apiKey" && Account.account?.type === "apiKey") { return; }
	}
	catch { /* Do not display authentication RPC diagnostics. */ }
	throw new Error("Codex 未能启用临时 API Key 登录, 请检查密钥和本机登录策略");
}
