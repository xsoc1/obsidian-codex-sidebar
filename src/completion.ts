import { CodexConnection, type RpcMessage } from "./rpc";
import { skill_input, type SkillInput } from "./skills";
import { authenticate_api_key } from "./api-auth";
import { MathCompletionInstructions, completion_prompt, parse_completion, type CompletionInput } from "./completion-prompt";
export { CompletionInstructions, MathCompletionInstructions, completion_prompt, parse_completion, type CompletionInput } from "./completion-prompt";

export class CompletionService
{
	private Workers = new Set<CodexConnection>();
	private Cancellations = new Set<() => void>();

	close(): void
	{
		for(const Cancel of this.Cancellations)
		{
			Cancel();
		}
		this.Workers.clear();
		this.Cancellations.clear();
	}

	async complete(Cli: string, Cwd: string, Input: CompletionInput, Options: { model?: string; effort?: string; serviceTier: string }, Signal: AbortSignal, Skill: SkillInput, ApiKey?: string): Promise<string>
	{
		if(Signal.aborted)
		{
			throw new Error("补全已取消");
		}
		let ThreadId = "";
		const Messages = new Map<string, string>();
		let Resolve!: (Value: string) => void;
		let Reject!: (ErrorValue: Error) => void;
		const Done = new Promise<string>((ResolveValue, RejectValue) => { Resolve = ResolveValue; Reject = RejectValue; });
		// Initialization failures may precede awaiting the streamed result.
		void Done.catch(() => {});
		const Worker = new CodexConnection(Cli, Cwd, (Message: RpcMessage) =>
		{
			if(Message.id !== undefined && Message.method)
			{
				Worker.send({ id: Message.id, error: { code: -32601, message: "Tools and approvals are unavailable for inline completion" } });
				return;
			}
			const Params = Message.params;
			if(!Params || Params.threadId !== ThreadId)
			{
				return;
			}
			if(Message.method === "item/agentMessage/delta")
			{
				Messages.set(Params.itemId, (Messages.get(Params.itemId) ?? "") + Params.delta);
			}
			if(Message.method === "item/completed" && Params.item.type === "agentMessage")
			{
				Messages.set(Params.item.id, Params.item.text);
			}
			if(Message.method === "turn/completed")
			{
				if(Params.turn.status === "completed")
				{
					Resolve([...Messages.values()].at(-1) ?? "");
				}
				else
				{
					Reject(new Error(Params.turn.error?.message ?? "补全未完成"));
				}
			}
		}, Reject, ApiKey);
		this.Workers.add(Worker);
		const Cancel = () =>
		{
			Worker.close();
			Reject(new Error("补全已取消"));
		};
		Signal.addEventListener("abort", Cancel, { once: true });
		this.Cancellations.add(Cancel);
		const Timer = setTimeout(Cancel, 45000);
		try
		{
			await Worker.request("initialize", { clientInfo: { name: "obsidian_codex_completion", version: "0.6.0" }, capabilities: { experimentalApi: true } });
			Worker.send({ method: "initialized", params: {} });
			if(ApiKey) { await authenticate_api_key(Worker, Cwd, ApiKey); }
			const Result = await Worker.request("thread/start", { cwd: Cwd, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", developerInstructions: MathCompletionInstructions, model: Options.model, serviceTier: Options.serviceTier, config: { model_reasoning_effort: Options.effort ?? "low" } });
			ThreadId = Result.thread.id;
			if(Result.thread.ephemeral !== true || Result.thread.path)
			{
				throw new Error("CLI 未提供临时补全会话");
			}
			await Worker.request("thread/inject_items", { threadId: ThreadId, items: [{ type: "message", role: "developer", content: [{ type: "input_text", text: MathCompletionInstructions }] }] });
			await Worker.request("turn/start", { threadId: ThreadId, input: skill_input(completion_prompt(Input), Skill), ...Options, summary: "none", outputSchema: { type: "object", properties: { completion: { type: "string" } }, required: ["completion"], additionalProperties: false } });
			return parse_completion(await Done);
		}
		finally
		{
			clearTimeout(Timer);
			Signal.removeEventListener("abort", Cancel);
			Worker.close();
			this.Workers.delete(Worker);
			this.Cancellations.delete(Cancel);
		}
	}
}
