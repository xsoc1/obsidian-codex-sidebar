import { api_base, valid_backend_model_id, type ApiProvider } from "./backend-profile";
import { direct_api_key } from "./direct-api";
import { native_http } from "./native-http";

export async function list_api_models(Provider: ApiProvider, CustomBase: string, Key: string, Send: Parameters<typeof native_http>[1]): Promise<string[]>
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
		} }, Send);
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
	const Models = Data.map((Item: { id?: unknown } | null) => Item?.id)
		.filter((Id): Id is string => valid_backend_model_id(Id) && (!Secret || !Id.includes(Secret)));
	return [...new Set(Models)].sort();
}
