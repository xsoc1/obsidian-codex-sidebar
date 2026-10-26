import type { EditRecord } from "./store";
import type { WritePlan } from "./write-types";
import type { WriteTarget } from "./task";
import { markdown_blocks } from "../markdown-blocks";

export function write_status(State: WritePlan["State"]): string
{
	return { preview: "等待确认", pending: "写入结果待核对", applied: "已采用", undone: "已安全还原", conflict: "内容冲突" }[State];
}
export function retention_label(Record: EditRecord, Policy: number): string
{
	const C = Record.Cache;
	if(!C) { return "旧记录: 不自动清理"; }
	if(Policy === 0) { return "修改与还原缓存: 永不自动清理"; }
	if(!C.Armed || C.Remaining === null) { return "修改预览完成后开始计算保留轮数"; }
	return C.Remaining === 0 ? "修改缓存已到期; 冲突或未完成恢复记录暂时保留" : `修改与还原缓存: 原会话后续完成 ${C.Remaining} 轮对话后清理`;
}
export function target_location(Target: WriteTarget): { Heading: string; Start: number; End: number }
{
	const Text = Target.Before ?? "", From = Target.Range?.From ?? 0, To = Math.max(From, (Target.Range?.To ?? From + 1) - 1);
	const Headings: { Level: number; Text: string }[] = [];
	for(const Block of markdown_blocks(Text))
	{
		if(Block.From > From) { break; }
		if(Block.Kind !== "heading") { continue; }
		const Match = Block.Text.match(/^\s*(#{1,6})\s+(.+)/); if(!Match) { continue; }
		while(Headings.length && Headings.at(-1)!.Level >= Match[1].length) { Headings.pop(); }
		Headings.push({ Level: Match[1].length, Text: Match[2].replace(/\s+#+\s*$/, "") });
	}
	return { Heading: Headings.map(H => H.Text).join(" > "), Start: Text.slice(0, From).split("\n").length, End: Text.slice(0, To).split("\n").length };
}
