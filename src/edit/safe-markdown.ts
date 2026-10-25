// Render a small, inert mathematics subset without executable plugin blocks.
export function safe_math_markdown(Text: string): boolean
{
	const Prose = Text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, "");
	return !/```|~~~|!\[\[|!\[[^\]]*\]\(|javascript\s*:|data\s*:\s*text\/html/i.test(Text) && !/<\/?[A-Za-z][^>]*>/.test(Prose);
}
