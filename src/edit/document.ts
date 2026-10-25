export function note_path(Path: string): string
{
	if(Path !== Path.trim() || !Path.endsWith(".md") || Path.length > 240 || /[\\:\u0000-\u001f<>"|?*]/.test(Path) || Path.split("/").some(Part => !Part || Part === "." || Part === ".." || Part.startsWith(".") || /[. ]$/.test(Part)))
	{
		throw new Error("目标必须是 vault 内普通 Markdown 路径, 不能越界或进入配置目录");
	}
	return Path;
}
export function source_path(Path: string): string
{
	note_path(Path.toLowerCase().endsWith(".pdf") ? Path.slice(0, -4) + ".md" : Path);
	return Path;
}

export async function version_of(Text: string | null): Promise<string>
{
	if(Text === null)
	{
		return "absent";
	}
	const Hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Text));
	return Array.from(new Uint8Array(Hash), Value => Value.toString(16).padStart(2, "0")).join("");
}
export function block_ids(Text: string): string[]
{
	return markdown_lines(Text).filter(Value => Value.Active).flatMap(Value => {
		const Match = Value.Text.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/); return Match ? [Match[1]] : [];
	});
}
function markdown_lines(Text: string): { Text: string; Active: boolean }[]
{
	let Fence = ""; let Math = false; let Yaml = Text.startsWith("---\n");
	return Text.split("\n").map((Line, Index) =>
	{
		if(Yaml)
		{
			if(Index && Line === "---") { Yaml = false; } return { Text: Line, Active: false };
		}
		const Marker = Line.match(/^\s*(`{3,}|~{3,})/);
		if(Marker)
		{
			Fence = Fence ? Marker[1][0] === Fence[0] && Marker[1].length >= Fence.length ? "" : Fence : Marker[1];
			return { Text: Line, Active: false };
		}
		if(!Fence && Line.trim() === "$$") { Math = !Math; return { Text: Line, Active: false }; }
		return { Text: Line, Active: !Fence && !Math };
	});
}
export function unique_blocks(Text: string): void
{
	const Ids = block_ids(Text);
	if(new Set(Ids).size !== Ids.length)
	{
		throw new Error("正文含重复块 ID");
	}
}
