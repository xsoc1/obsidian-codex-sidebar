export type StudyAction = "explain" | "symbols" | "expand" | "check" | "exercise" | "feedback" | "solution" | "sample" | "chapter" | "proposal";
export type InputRole = "lecture" | "problem" | "complete-answer" | "outline" | "source-excerpt" | "teacher-problem";
export interface ExerciseOutput
{
	schemaVersion: 1;
	kind: "calculation" | "symbols" | "conditions" | "proof-step";
	statement: string;
	hints: string[];
	solution: string | null;
	verification: "unverified";
}
export interface FeedbackOutput
{
	schemaVersion: 1;
	verdict: "correct" | "partial" | "incorrect" | "uncertain";
	explanation: string;
}
export interface SolutionOutput
{
	schemaVersion: 1;
	solution: string | null;
	verification: "unverified";
}
export interface DraftOutput
{
	schemaVersion: 1;
	markdown: string;
	rationale: string;
	verification: "unverified";
}
export interface ProposalOutput extends DraftOutput
{
	operation: "insert-after" | "replace-unit";
}

import { safe_math_markdown } from "./safe-markdown";

function object(Value: unknown, Keys: string[]): Record<string, unknown>
{
	if(!Value || typeof Value !== "object" || Array.isArray(Value) || Object.keys(Value).some(Key => !Keys.includes(Key)) || Keys.some(Key => !(Key in Value)))
	{
		throw new Error("结构化输出字段不匹配");
	}
	return Value as Record<string, unknown>;
}
function text(Value: unknown, Limit: number): string
{
	if(typeof Value !== "string" || !Value.trim() || Value.length > Limit || Value.includes("\u0000"))
	{
		throw new Error("结构化文本为空或超出上限");
	}
	if(/\\n(?![a-zA-Z])/.test(Value) || /(^|[^\\])\\\\(?:mathbb|mathfrak|begin|end|frac|operatorname|alpha|varepsilon)\b/.test(Value))
	{
		throw new Error("Markdown 被双重转义; 请重发原任务, 使用真实换行和单层 JSON 转义");
	}
	if(!safe_math_markdown(Value))
	{
		throw new Error("数学工作台不接受代码围栏、HTML、脚本或自动嵌入; 请返回普通数学 Markdown");
	}
	return Value;
}
function one_of<T extends string>(Value: unknown, Choices: readonly T[]): T
{
	if(!Choices.includes(Value as T))
	{
		throw new Error("结构化输出含未知选项");
	}
	return Value as T;
}
export function parse_output(Action: StudyAction, Text: string): ExerciseOutput | FeedbackOutput | SolutionOutput | DraftOutput | ProposalOutput
{
	if(Text.length > 80000)
	{
		throw new Error("结构化输出过长");
	}
	const Value = JSON.parse(Text.trim());
	if(Action === "solution")
	{
		const Data = object(Value, ["schemaVersion", "solution", "verification"]);
		if(Data.schemaVersion !== 1)
		{
			throw new Error("解答版本无效");
		}
		return { schemaVersion: 1, solution: Data.solution === null ? null : text(Data.solution, 12000), verification: one_of(Data.verification, ["unverified"]) };
	}
	if(Action === "exercise")
	{
		const Data = object(Value, ["schemaVersion", "kind", "statement", "hints", "solution", "verification"]);
		if(Data.schemaVersion !== 1 || !Array.isArray(Data.hints) || Data.hints.length > 4)
		{
			throw new Error("练习版本或提示数量无效");
		}
		return { schemaVersion: 1, kind: one_of(Data.kind, ["calculation", "symbols", "conditions", "proof-step"]), statement: text(Data.statement, 6000), hints: Data.hints.map(Value => text(Value, 4000)), solution: Data.solution === null ? null : text(Data.solution, 12000), verification: one_of(Data.verification, ["unverified"]) };
	}
	if(Action === "feedback")
	{
		const Data = object(Value, ["schemaVersion", "verdict", "explanation"]);
		if(Data.schemaVersion !== 1)
		{
			throw new Error("反馈版本无效");
		}
		return { schemaVersion: 1, verdict: one_of(Data.verdict, ["correct", "partial", "incorrect", "uncertain"]), explanation: text(Data.explanation, 12000) };
	}
	const IsProposal = Action === "proposal";
	const Data = object(Value, ["schemaVersion", "markdown", "rationale", "verification", ...(IsProposal ? ["operation"] : [])]);
	if(Data.schemaVersion !== 1)
	{
		throw new Error("稿件版本无效");
	}
	const Draft: DraftOutput = { schemaVersion: 1, markdown: text(Data.markdown, 48000), rationale: text(Data.rationale, 6000), verification: one_of(Data.verification, ["unverified"]) };
	return IsProposal ? { ...Draft, operation: one_of(Data.operation, ["insert-after", "replace-unit"]) } : Draft;
}
