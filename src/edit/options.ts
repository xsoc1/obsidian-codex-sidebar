import type { EditScope } from "./protocol";

export const EditScopeOptions: readonly [EditScope, string][] = [
	["ai", "AI 自选当前笔记中的修改范围"],
	["captured", "严格只改选区 / 捕获的 Markdown 块"],
	["note", "当前整篇笔记 (最多 24000 字符)"]
];

export function edit_scope(Value: unknown): EditScope
{
	return Value === "captured" || Value === "note" ? Value : "ai";
}
