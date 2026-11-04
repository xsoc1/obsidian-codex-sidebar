import { api_base, valid_backend_model_id, type ApiCatalogModel, type ApiProvider, type ApiReasoning } from "./backend-profile";
import { direct_api_key } from "./direct-api";
import { native_http } from "./native-http";

const GoEffortNames = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const DeepSeekEffortNames = new Set(["low", "high", "max"]);

function effort_levels(Value: unknown, Accepted: ReadonlySet<string>): string[]
{
	return Array.isArray(Value) ? [...new Set(Value.filter((Item): Item is string => typeof Item === "string" && Accepted.has(Item)))] : [];
}

function go_reasoning(Item: { capabilities?: { reasoning?: { supported?: unknown; effort?: unknown } }; api?: Record<string, unknown> }): ApiReasoning | undefined
{
	const Reasoning = Item.capabilities?.reasoning;
	if(Reasoning?.supported !== true || !Array.isArray(Reasoning.effort)) { return; }
	const Format = Item.api?.["chat-completions"] ? "chat" : Item.api?.responses ? "responses" : null;
	const Efforts = effort_levels(Reasoning.effort, GoEffortNames);
	if(Format && Efforts.length) { return { Format, Efforts }; }
}

function deepseek_reasoning(Item: { effort?: { supported_levels?: unknown } }): ApiReasoning | undefined
{
	const Efforts = effort_levels(Item.effort?.supported_levels, DeepSeekEffortNames);
	if(Efforts.length) { return { Format: "chat", Efforts: ["none", ...Efforts] }; }
}

export async function list_api_models(Provider: ApiProvider, CustomBase: string, Key: string, Send: Parameters<typeof native_http>[1], Timeout?: number): Promise<ApiCatalogModel[]>
{
	const Base = api_base(Provider, CustomBase);
	const Public = Provider === "opencode";
	const Secret = Public ? "" : direct_api_key(Key);
	const Url = Public ? "https://opencode.ai/inference/go/v1/models" : Base + "/models";
	let Result: Awaited<ReturnType<typeof native_http>>;
	try
	{
		Result = await native_http({ url: Url, method: "GET", headers: {
			Accept: "application/json", ...(Secret ? { Authorization: `Bearer ${Secret}` } : {})
		} }, Send, Timeout);
	}
	catch { throw new Error("读取模型列表时网络失败或超时"); }
	if(Result.status < 200 || Result.status >= 300)
	{
		const Hint = Result.status === 401 || Result.status === 403 ? "请检查 API Key 和项目权限"
			: [404, 405, 501].includes(Result.status) ? "接口可能不提供模型列表, 请检查基础地址"
			: Result.status === 429 ? "请求过于频繁, 请稍后再试" : "请检查服务商状态";
		throw new Error(`读取模型列表失败 (HTTP ${Result.status}). ${Hint}`);
	}
	let Data: unknown;
	try { Data = Result.json?.data; }
	catch { throw new Error("服务商未返回有效的 JSON 模型列表"); }
	if(!Array.isArray(Data)) { throw new Error("服务商未返回兼容的模型列表"); }
	const Models = new Map<string, ApiCatalogModel>();
	for(const Item of Data)
	{
		const Id = Item?.id;
		if(!valid_backend_model_id(Id) || Secret && Id.includes(Secret) || Models.has(Id)) { continue; }
		const Reasoning = Public ? go_reasoning(Item) : Provider === "deepseek" ? deepseek_reasoning(Item) : undefined;
		Models.set(Id, Reasoning ? { Id, Reasoning } : { Id });
	}
	return [...Models.values()].sort((A, B) => A.Id < B.Id ? -1 : 1);
}
