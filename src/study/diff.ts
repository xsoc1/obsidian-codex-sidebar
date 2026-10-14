export function diff_preview(Before: string | null, After: string): string
{
	const Old = (Before ?? "").split("\n"); const Next = After.split("\n");
	let Head = 0; let Tail = 0;
	while(Head < Old.length && Head < Next.length && Old[Head] === Next[Head])
	{
		Head++;
	}
	while(Tail < Old.length - Head && Tail < Next.length - Head && Old[Old.length - Tail - 1] === Next[Next.length - Tail - 1])
	{
		Tail++;
	}
	return `--- ${Before === null ? "新文件" : "原文"}\n+++ 待采用稿\n@@ 原文第 ${Head + 1} 行 / 新文第 ${Head + 1} 行 @@\n` + [
		...Old.slice(Math.max(0, Head - 2), Head).map(Line => " " + Line),
		...Old.slice(Head, Old.length - Tail).map(Line => "-" + Line),
		...Next.slice(Head, Next.length - Tail).map(Line => "+" + Line),
		...Old.slice(Old.length - Tail, Old.length - Tail + 2).map(Line => " " + Line)
	].join("\n");
}
