import { ApiProviders, type BackendProfile } from "./backend-profile";
import { BackendResultUnknown, type BackendDriver, type BackendMessage } from "./backend";
import { native_http } from "./native-http";
import type { BrowserRequest } from "./browser-http";
import { ProductVersion } from "./version";

type Profile = Extract<BackendProfile, { Kind: "api" }>;
type NativeRequest = (Value: BrowserRequest) => PromiseLike<{ status: number; json: any }>;

export function direct_api_key(Value: string): string
{
	const Key = Value.trim();
	if(!/^[!-~]{8,1024}$/.test(Key)) { throw new Error("请填写该服务商的 API Key"); }
	return Key;
}

function response_text(Value: any): string
{
	if(Value?.status !== "completed" || !Array.isArray(Value.output)) { throw new Error("Responses 请求未完整完成"); }
	return Value.output.filter((Item: any) => Item?.type === "message" && Item.role === "assistant" && Array.isArray(Item.content))
		.flatMap((Item: any) => Item.content.filter((Part: any) => Part?.type === "output_text" && typeof Part.text === "string").map((Part: any) => Part.text)).join("\n\n");
}

function chat_message(Message: BackendMessage)
{
	return { role: Message.Role, content: Message.Images?.length ? [
		{ type: "text", text: Message.Text },
		...Message.Images.map(url => ({ type: "image_url", image_url: { url } }))
	] : Message.Text };
}

export function direct_api(Profile: Profile, Key: string, Send: NativeRequest): BackendDriver
{
	Key = direct_api_key(Key);
	const Responses = ApiProviders[Profile.Provider].Format === "responses";
	return async ({ Session, Messages }, Signal) =>
	{
		Signal.throwIfAborted();
		if(!Profile.Vision && Messages.some(M => M.Images?.length)) { throw new Error("当前 API 模型未启用图像输入"); }
		const Request = Responses
			? { model: Profile.Model, store: false, input: Messages.map(M => ({
				role: M.Role === "system" ? "developer" : M.Role,
				content: M.Images?.length ? [{ type: "input_text", text: M.Text }, ...M.Images.map(image_url => ({ type: "input_image", image_url, detail: "auto" }))] : M.Text
			})) }
			: { model: Profile.Model, messages: Messages.map(chat_message), stream: false };
		const Body = JSON.stringify(Request);
		if(Body.length > 12 * 1024 * 1024) { throw new Error("当前 API 输入过长, 请缩小选区或开启新会话"); }
		const Headers = { Authorization: `Bearer ${Key}`, "Content-Type": "application/json",
			...(Profile.Provider === "opencode" ? { "User-Agent": `Obsidian-Codex-Sidebar/${ProductVersion}`, "x-opencode-session": `ses_${Session.replace(/[^a-z0-9]/gi, "")}` } : {}) };
		let Result: { status: number; json: any };
		try
		{
			Result = await native_http({ url: Profile.Base + (Responses ? "/responses" : "/chat/completions"), method: "POST", headers: Headers, body: Body }, Send, 180000);
		}
		catch { throw new BackendResultUnknown("API 网络请求失败或超时, 服务端结果待核对; 未自动重发"); }
		Signal.throwIfAborted();
		if(Result.status < 200 || Result.status >= 300)
		{
			const Hint = Result.status === 401 || Result.status === 403 ? "核对密钥、项目权限及模型可用性" : Result.status === 429 ? "核对额度或频率限制" : "核对模型 ID、端点或服务商状态";
			throw new Error(`API HTTP ${Result.status}. ${Hint}`);
		}
		if(Responses) { return response_text(Result.json).replaceAll(Key, "[redacted]"); }
		const Choice = Result.json?.choices?.[0];
		if(Choice?.finish_reason !== "stop" || typeof Choice?.message?.content !== "string") { throw new Error("服务商未返回完整正文, 请检查输出限制或模型兼容性"); }
		return Choice.message.content.replaceAll(Key, "[redacted]");
	};
}
