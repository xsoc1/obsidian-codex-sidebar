// Randomized presentation for author/reader review, never an automatic quality score.
import { randomInt, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DevelopmentCases, HoldoutCases } from "../examples/exposition/cases";

const Directory = process.env.CODEX_EXPOSITION_EVIDENCE;
const Stage = process.env.CODEX_EXPOSITION_STAGE;
if(!Directory || !["development", "holdout"].includes(Stage ?? "")) { throw new Error("Set evidence directory and review stage"); }
const Samples = Stage === "holdout" ? HoldoutCases : DevelopmentCases.filter(Value => ["D02", "D04", "D08", "D14"].includes(Value.Id));
const MappingPath = join(Directory, Stage + "-review-order.json");
const Order: Record<string, string[]> = existsSync(MappingPath) ? JSON.parse(readFileSync(MappingPath, "utf8")) : Object.fromEntries(Samples.map(Value => [Value.Id, randomInt(2) ? ["baseline", "candidate"] : ["candidate", "baseline"]]));
writeFileSync(MappingPath, JSON.stringify(Order, null, 2));
for(const Sample of Samples)
{
	let Text = "# " + Sample.Id + " 顺序匿名核读\n\n任务: " + Sample.Request + "\n\n来源:\n\n" + Sample.Source + "\n";
	for(const [Index, Variant] of Order[Sample.Id].entries())
	{
		const Run = process.env.CODEX_EXPOSITION_RUN;
		const Revised = Run ? join(Directory, Variant + "-" + Run + "-" + Sample.Id + ".json") : "";
		const Record = JSON.parse(readFileSync(Revised && existsSync(Revised) ? Revised : join(Directory, Variant + "-" + Sample.Id + ".json"), "utf8"));
		let Output = Record.output;
		try
		{
			const Value = JSON.parse(Output);
			Output = (Value.markdown ?? Value.explanation ?? Value.solution ?? (Value.markdown === null ? "本轮未生成替换稿。" : Output)) + (Value.rationale ? "\n\n具体理由: " + Value.rationale : "") + (Value.status ? "\n\n状态: " + Value.status : "") + (Value.verdict ? "\n\n反馈结论: " + Value.verdict : "");
		}
		catch { }
		Text += "\n## " + (Index ? "B" : "A") + "\n\n" + Output + "\n";
	}
	writeFileSync(join(Directory, "review-" + Sample.Id + ".md"), Text);
}
process.stdout.write(JSON.stringify({ stage: Stage, pairs: Samples.length, criteria: "information / expression / teaching / product; author review is not independent human acceptance", inputsSha256: createHash("sha256").update(JSON.stringify(Samples)).digest("hex") }) + "\n");
