// Opt-in acceptance: original PDFs only, owned hidden CLI and temporary bridge/state.
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { RemoteBridge, token_hash } from "../src/bridge";
import { jpeg_info, pdf_hash, pdf_reference } from "../src/pdf/types";
import { build_prompt, DefaultInstructions, instruction_items, type ContextSnapshot } from "../src/prompt";
import { history_items } from "../src/history";

async function run_live()
{
	const Cli = process.env.CODEX_PDF_TEST_CLI, Input = process.env.CODEX_PDF_IMAGES_DIR;
	if(!Cli || !Input) { throw new Error("Set CODEX_PDF_TEST_CLI and CODEX_PDF_IMAGES_DIR containing original native capture result.json/JPEGs; never reads authentication files."); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-pdf-live-")); cpSync("examples/pdf", Directory, { recursive: true });
	writeFileSync(join(Directory, "AGENTS.md"), "# Original PDF test\nUse supplied immutable page snapshots. Do not write files, read authentication/configuration, or private notes. No tool execution needed.\n");
	const Sources: ContextSnapshot[] = JSON.parse(readFileSync(join(Input, "result.json"), "utf8")).snapshots;
	const Token = randomBytes(24).toString("hex");
	const Config = { Port: 0, Cli, Cwd: Directory, Vault: "original-pdf-test", ObsidianCli: "not-used", StateDir: join(Directory, "state"), Clients: [{ Id: "original-device", Hash: token_hash(Token) }] };
	let Bridge = new RemoteBridge(Config), Port = await Bridge.listen();
	let Sequence = 0, EventCursor = 0;
	const Rpc = async (Method: string, Params: any) =>
	{
		const Response = await fetch(`http://127.0.0.1:${Port}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${Token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: "pdf-test-" + ++Sequence, method: Method, params: Params }) });
		const Value = await Response.json() as any;
		assert.equal(Response.status, 200, Value.error ?? "RPC failed"); return Value;
	};
	const Results: any[] = [];
	const TextOnly = process.env.CODEX_PDF_TEST_STAGE === "text";
	const VisionOnly = process.env.CODEX_PDF_TEST_STAGE === "vision";
	try
	{
		const Catalog = await Rpc("model/list", {});
		const Model = Catalog.data.find((Value: any) => Value.model === "gpt-6.1-sol") ?? Catalog.data.find((Value: any) => Value.isDefault);
		assert.ok(!Model.inputModalities || Model.inputModalities.includes("image"));
		const Effort = Model.supportedReasoningEfforts.find((Value: any) => Value.reasoningEffort === "low")?.reasoningEffort ?? Model.defaultReasoningEffort;
		const Skill = { type: "skill", name: "math-writing", path: "/bridge/math-writing/SKILL.md" };
		async function thread(Name: string)
		{
			const Result = await Rpc("thread/start", { clientSessionId: Name, model: Model.model, config: { model_reasoning_effort: Effort }, serviceTier: "default", developerInstructions: DefaultInstructions + "\n只读 PDF 页图参考; 不确定则明说. 使用 Obsidian 数学 Markdown.", ephemeral: true, sandbox: "read-only", approvalPolicy: "never" });
			assert.equal(Result.thread.ephemeral, true); assert.equal(Result.thread.path, null); return Result.thread.id;
		}
		async function turn(Thread: string, Prompt: string, Source?: ContextSnapshot)
		{
			const InputItems: any[] = [{ type: "text", text: Prompt }, Skill];
			for(const Page of Source?.Pdf?.Pages ?? []) { InputItems.push({ type: "image", url: pdf_reference(Page.Image.Id) }); }
			const Started = await Rpc("turn/start", { threadId: Thread, input: InputItems, model: Model.model, effort: Effort, serviceTier: "default" });
			const Deadline = Date.now() + 150000;
			let Text = "";
			while(Date.now() < Deadline)
			{
				const Response = await fetch(`http://127.0.0.1:${Port}/events?after=${EventCursor}`, { headers: { Authorization: `Bearer ${Token}` } });
				const Events = await Response.json() as any; EventCursor = Events.cursor;
				let Turn: any = null;
				for(const { message: Message } of Events.events)
				{
					if(Message.params?.threadId !== Thread) { continue; }
					if(Message.method === "item/completed" && Message.params.turnId === Started.turn.id && Message.params.item.type === "agentMessage" && Message.params.item.phase !== "commentary") { Text += Message.params.item.text; }
					if(Message.method === "turn/completed" && Message.params.turn.id === Started.turn.id) { Turn = Message.params.turn; }
				}
				if(Turn?.status === "completed")
				{
					assert.ok(Text); Results.push({ inputs: InputItems.length, status: Turn.status, text: Text });
					writeFileSync(join(Directory, "progress-private.json"), JSON.stringify({ results: Results, stage: TextOnly ? "text" : VisionOnly ? "vision" : "full" }, null, 2));
					process.stdout.write(`completed original PDF request ${Results.length}\n`); return Text;
				}
				if(Turn?.status === "failed") { throw new Error(JSON.stringify(Turn.error)); }
				await new Promise(Resolve => setTimeout(Resolve, 800));
			}
			throw new Error("Original PDF model request timed out; no automatic resend");
		}
		const Epoch = (await Rpc("bridge/pdf-images", { action: "has", ids: [] })).epoch;
		for(const Source of Sources)
		{
			const Data: string = "data:image/jpeg;base64," + readFileSync(join(Input, Source.Path + ".jpg")).toString("base64");
			assert.equal(await pdf_hash(Data), Source.Pdf!.Pages[0].Image.Id); assert.deepEqual(jpeg_info(Data), { Width: Source.Pdf!.Pages[0].Image.Width, Height: Source.Pdf!.Pages[0].Image.Height, Bytes: Source.Pdf!.Pages[0].Image.Bytes });
			await Rpc("bridge/pdf-images", { action: "put", id: Source.Pdf!.Pages[0].Image.Id, data: Data, epoch: Epoch });
		}
		const Scan = Sources.find(Value => Value.Mapping === "PDF页图")!;
		assert.ok(!Scan.Text.includes("PHI-2718"));
		const Prompt = build_prompt("直接读图, 复述页面中 Visual marker 的值, 再解释展开式中间项和页面中的数值核验. 不读其他文件, 不反问.", Scan);
		if(!TextOnly)
		{
			const First = await turn(await thread("scan"), Prompt, Scan);
			assert.match(First, /PHI[−–-]2718/); assert.match(First, /25/);
			await Bridge.close(); Bridge = new RemoteBridge(Config); Port = await Bridge.listen(); EventCursor = 0;
			const Present = await Rpc("bridge/pdf-images", { action: "has", ids: [Scan.Pdf!.Pages[0].Image.Id] }); assert.equal(Present.present.length, 1);
			const RestoredThread = await thread("replayed-scan");
			const Urls = new Map([[Scan.Pdf!.Pages[0].Image.Id, pdf_reference(Scan.Pdf!.Pages[0].Image.Id)]]);
			// Omit the old answer so the replay test cannot copy the marker from assistant text.
			await Rpc("thread/inject_items", { threadId: RestoredThread, items: history_items([{ Id: "original", Role: "user", Text: "read original", Prompt, Context: Scan }], Urls) });
			const Replayed = await turn(RestoredThread, "核对恢复的原页图, 只复述图中的 Visual marker. 不读文件."); assert.match(Replayed, /PHI[−–-]2718/);
		}
		if(!VisionOnly)
		{
			const TextSource = Sources.find(Value => Value.Mapping === "PDF文本层")!;
			const TextPrompt = build_prompt("解释这页矩阵交换子计算中两种乘法次序的差别, 给出具体依据, 不读取文件.", TextSource);
			await turn(await thread("text-explanation"), TextPrompt, TextSource);
		}
		const Report = { schemaVersion: 1, stage: TextOnly ? "text" : VisionOnly ? "vision" : "full", originalOnly: true, model: Model.model, effort: Effort, bridgeRestartCache: !TextOnly, actualImageInput: true, rawHistoryImageAccepted: !TextOnly, textExplanationCompleted: !VisionOnly, results: Results };
		writeFileSync(join(Directory, "result-private.json"), JSON.stringify(Report, null, 2));
		process.stdout.write(`PDF live acceptance passed; private evidence: ${Directory}\n`);
	}
	finally { await Bridge.close(); }
}
void run_live().catch(ErrorValue => { process.stderr.write(String(ErrorValue) + "\n"); process.exitCode = 1; });
