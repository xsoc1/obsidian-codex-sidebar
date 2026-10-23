// Opt-in real inference on original examples; never starts the daily plugin or bridge.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnection, type RpcMessage } from "../src/rpc";
import { math_writing_skill, skill_input } from "../src/skills";
import { DefaultInstructions, build_prompt, instruction_items } from "../src/prompt";
import { answer_quote } from "../src/quote";
import { history_items } from "../src/history";

async function run_live(): Promise<void>
{
	const Cli = process.env.CODEX_FOLLOWUP_TEST_CLI;
	if(!Cli) { throw new Error("Set CODEX_FOLLOWUP_TEST_CLI; no authentication file is read"); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-followup-live-"));
	writeFileSync(join(Directory, "AGENTS.md"), "# Original follow-up test\nUse only the supplied original mathematics and math-writing references. Read only. Do not access private notes/authentication/config or write files.\n");
	const Cases = [
		{
			Id: "analysis",
			Source: "设 $X$ 是赋范空间. 范数给出向量的大小, 距离定义为 $d(x,y)=\\|x-y\\|$.\n\n由三角不等式, $\\|x\\|\\leq\\|x-y\\|+\\|y\\|$. 交换 $x,y$ 后便得到反三角不等式\n\n$$\n|\\|x\\|-\\|y\\||\\leq\\|x-y\\|.\n$$\n\n因此, 若 $x_n\\to x$, 则 $\\|x_n\\|\\to\\|x\\|$. 范数函数连续, 这里并不需要 $X$ 完备. 进一步, 若 $(x_n)$ 是 Cauchy 列, 则 $(\\|x_n\\|)$ 也是实数 Cauchy 列; 这并不能反过来保证 $(x_n)$ 收敛.",
			Selected: "交换 x,y 后便得到反三角不等式",
			Question: "交换后怎么就变成绝对值了? 我不清楚这一步和后面的连续性有什么关系."
		},
		{
			Id: "lie",
			Source: "在实矩阵代数 $M_2(\\mathbb R)$ 中定义 $[A,B]=AB-BA$. 取\n\n$$\nH=\\begin{pmatrix}1&0\\\\0&-1\\end{pmatrix},\\quad E=\\begin{pmatrix}0&1\\\\0&0\\end{pmatrix}.\n$$\n\n直接计算得 $HE=E$, $EH=-E$, 所以 $[H,E]=2E$.\n\n定义 $\\operatorname{ad}_H(A)=[H,A]$. 由于矩阵乘法对加法和数乘分别线性, $\\operatorname{ad}_H$ 是线性映射; 以上计算表明 $E$ 是它的特征值 $2$ 对应的特征向量. 注意 $E\\ne0$.",
			Selected: "直接计算得 HE=E, EH=-E",
			Question: "左右乘为什么符号不同? 请把这一步讲细一点."
		}
	];
	const Done = new Map<string, any>(), Texts = new Map<string, string>(), Waiters = new Map<string, (Value: any) => void>();
	let Connection: CodexConnection;
	Connection = new CodexConnection(Cli, Directory, (Message: RpcMessage) =>
	{
		if(Message.id !== undefined && Message.method) { Connection.send({ id: Message.id, error: { code: -32601, message: "No extra tools or approvals in this test" } }); return; }
		const Params = Message.params;
		if(Message.method === "item/completed" && Params.item.type === "agentMessage" && Params.item.phase !== "commentary") { Texts.set(Params.turnId, Params.item.text); }
		if(Message.method === "turn/completed") { Done.set(Params.turn.id, Params.turn); Waiters.get(Params.turn.id)?.(Params.turn); }
	}, ErrorValue => process.stderr.write(String(ErrorValue) + "\n"));
	process.stdout.write(JSON.stringify({ directory: Directory }) + "\n");
	try
	{
		await Connection.request("initialize", { clientInfo: { name: "obsidian_followup_acceptance", version: "0.14.0" }, capabilities: { experimentalApi: true } });
		Connection.send({ method: "initialized", params: {} });
		const Skill = math_writing_skill(await Connection.request("skills/list", { cwds: [Directory], forceReload: true }), Directory);
		const SkillVersion = readFileSync(Skill.path, "utf8").match(/version:\s*"?([^"\r\n]+)/)?.[1].trim() ?? "unconfirmed";
		const Models = await Connection.request("model/list", { limit: 100, includeHidden: false });
		const Model = Models.data.find((Value: any) => Value.model === "gpt-6.1-sol");
		assert.ok(Model?.supportedReasoningEfforts.some((Value: any) => Value.reasoningEffort === "low"));
		for(const Sample of Cases)
		{
			const Thread = await Connection.request("thread/start", { cwd: Directory, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", model: Model.model });
			assert.equal(Thread.thread.path, null); assert.equal(Thread.thread.ephemeral, true);
			await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: instruction_items(DefaultInstructions) });
			await Connection.request("thread/inject_items", { threadId: Thread.thread.id, items: history_items([{ Id: "original", Role: "assistant", Text: Sample.Source }]) });
			const Prompt = build_prompt(Sample.Question, null, answer_quote("original-session", "original", Sample.Selected, Sample.Source, "completed"));
			const Input = skill_input(Prompt, Skill); assert.equal(Input.length, 2);
			writeFileSync(join(Directory, Sample.Id + "-request.json"), JSON.stringify({ ...Sample, prompt: Prompt, status: "submitting", model: Model.model, effort: "low", skillVersion: SkillVersion }, null, 2));
			process.stdout.write(JSON.stringify({ id: Sample.Id, status: "submitting" }) + "\n");
			const Turn = await Connection.request("turn/start", { threadId: Thread.thread.id, input: Input, model: Model.model, effort: "low", serviceTier: "default" });
			let Timer: ReturnType<typeof setTimeout> | undefined;
			const Completed = Done.get(Turn.turn.id) ?? await new Promise<any>((Resolve, Reject) =>
			{
				Timer = setTimeout(() => Reject(new Error("Inference timed out; no automatic retry")), 150000);
				Waiters.set(Turn.turn.id, Resolve);
			}).finally(() => { clearTimeout(Timer); Waiters.delete(Turn.turn.id); });
			const Output = Texts.get(Turn.turn.id) ?? "";
			writeFileSync(join(Directory, Sample.Id + "-result.json"), JSON.stringify({ status: Completed.status, output: Output, model: Model.model, effort: "low", skillVersion: SkillVersion }, null, 2));
			assert.equal(Completed.status, "completed"); assert.ok(Output.trim());
			process.stdout.write(JSON.stringify({ id: Sample.Id, status: "completed", review: "Manual review of explanation and complete integration required", model: Model.model, effort: "low", skillVersion: SkillVersion }) + "\n");
		}
	}
	finally { Connection.close(); }
}

void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
