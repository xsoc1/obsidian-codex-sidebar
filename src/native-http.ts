import type { BrowserRequest } from "./browser-http";

export async function native_http(Request: BrowserRequest, Send: (Value: BrowserRequest) => PromiseLike<{ status: number; json: any }>, Timeout = 30000): Promise<{ status: number; json: any }>
{
	let Timer: ReturnType<typeof setTimeout>;
	const Deadline = new Promise<never>((_Resolve, Reject) =>
	{
		Timer = setTimeout(() => Reject(new Error(`原生网络请求超时 (${Timeout / 1000} 秒), 不会自动重发; 底层请求可能仍在进行`)), Timeout);
	});
	try { return await Promise.race([Promise.resolve(Send(Request)), Deadline]); }
	finally { clearTimeout(Timer!); }
}
