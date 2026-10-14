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
export function unit_range(Text: string, Id: string): { From: number; To: number }
{
	if(!/^[A-Za-z0-9-]+$/.test(Id))
	{
		throw new Error("单元块 ID 无效");
	}
	unique_blocks(Text);
	const Lines = Text.split("\n");
	const Parsed = markdown_lines(Text);
	const Ends = Parsed.map((Line, Index) => Line.Active && Line.Text.trim() === `^${Id}` ? Index : -1).filter(Index => Index >= 0);
	if(Ends.length !== 1)
	{
		throw new Error("指定单元定位不存在或不唯一; 需要独立一行的稳定块 ID");
	}
	const End = Ends[0];
	let Start = End - 1;
	// A study unit is a complete heading section ending at its standalone anchor.
	while(Start >= 0 && !(Parsed[Start].Active && /^#{1,6} /.test(Lines[Start])))
	{
		Start--;
	}
	if(Start < 0)
	{
		throw new Error("单元需要独立标题及末尾块 ID");
	}
	for(let Index = End + 1; Index < Lines.length; Index++)
	{
		if(Parsed[Index].Active && /^#{1,6} /.test(Lines[Index]))
		{
			break;
		}
		if(Lines[Index].trim())
		{
			throw new Error("单元锚点不是标题单元的末尾, 定位模糊");
		}
	}
	return { From: Lines.slice(0, Start).join("\n").length + (Start ? 1 : 0), To: Lines.slice(0, End + 1).join("\n").length };
}
