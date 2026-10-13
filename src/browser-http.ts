export interface BrowserRequest
{
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	timeout?: number;
}

export async function browser_http(Request: BrowserRequest, Fetch: typeof fetch = globalThis.fetch): Promise<{ status: number; json: any }>
{
	const Controller = new AbortController();
	const Timeout = Request.timeout ?? 30000;
	const Timer = setTimeout(() => Controller.abort(), Timeout);
	try
	{
		const Response = await Fetch(Request.url, { method: Request.method, headers: Request.headers, ...(Request.body === undefined ? {} : { body: Request.body }), signal: Controller.signal, credentials: "omit", cache: "no-store", redirect: "error" });
		return { status: Response.status, json: await Response.json() };
	}
	catch(ErrorValue)
	{
		if(Controller.signal.aborted)
		{
			throw new Error(`请求超时 (${Timeout / 1000} 秒), 不会自动重发`);
		}
		throw ErrorValue;
	}
	finally
	{
		clearTimeout(Timer);
	}
}
