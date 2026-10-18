const Polite = /^(?:(?:请你|请|麻烦你|麻烦|帮我|给我|你|直接|先|现在|顺便|就|再|只需|只要|我想让你|我希望你|能不能|能否|可以|帮忙)\s*)+/;

export function note_write_intent(Text: string): boolean
{
	for(const Part of Text.split(/[，,。.;；!！?？\n]/))
	{
		const Clause = Part.trim().replace(Polite, "");
		if(/^(?:不要|不必|不用|不需要|别|禁止|如何|怎么|怎样|为什么|解释|说明|分析|讨论|讲解|翻译|评价)/.test(Clause)) { continue; }
		if(/(?:是什么|什么意思|怎么操作|怎么做|的方法|的步骤|的原理)$/.test(Clause)) { continue; }
		if(/^(?:写|填|放|加|记|补)(?:入|进|到|上)/.test(Clause) || /^(?:写|填|放|加|记|补)[^\n]{0,160}(?:上去|进去)/.test(Clause)) { return true; }
		if(/^(?:把|将)[^\n]{0,160}(?:写|填|放|加|记|补)(?:入|进|到|上)/.test(Clause)) { return true; }
		if(/^(?:在|往|向)[^\n]{0,60}(?:笔记|讲义|原文|答案|解答|空白|留白)[^\n]{0,30}(?:写|填|放|加|记|补)/.test(Clause)) { return true; }
		const English = Clause.replace(/^(?:(?:please|could you|can you|would you|just|now)\s+)+/i, "");
		if(/^(?:write|put|add)\b.{0,160}\b(?:into|in|to|onto)\s+(?:(?:the|this|my|current)\s+)?(?:note|lecture|answer|solution|proof)\b|^fill\s+in\s+(?:(?:the|this)\s+)?(?:answer|solution|proof)\b/i.test(English)) { return true; }
	}
	return false;
}
