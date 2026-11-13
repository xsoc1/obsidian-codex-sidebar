/** Inspect data properties before reading them; schema input never runs getters. */
export function data_record(Value: unknown, Allowed: readonly string[], Required: readonly string[] = Allowed): Record<string, unknown>
{
	if(!Value || typeof Value !== "object" || Array.isArray(Value) || ![Object.prototype, null].includes(Object.getPrototypeOf(Value))) { throw Error("交互内容需要普通对象"); }
	for(const Key of Reflect.ownKeys(Value))
	{
		if(typeof Key !== "string" || !Allowed.includes(Key)) { throw Error("交互内容含未知字段"); }
		if(!Object.hasOwn(Object.getOwnPropertyDescriptor(Value, Key)!, "value")) { throw Error("交互字段不能是访问器"); }
	}
	for(const Key of Required) { if(!Object.hasOwn(Value, Key)) { throw Error("交互内容缺少字段 " + Key); } }
	return Value as Record<string, unknown>;
}

export function data_list(Value: unknown, Max: number, Min = 0): unknown[]
{
	if(!Array.isArray(Value) || Object.getPrototypeOf(Value) !== Array.prototype || Value.length < Min || Value.length > Max || Reflect.ownKeys(Value).length !== Value.length + 1) { throw Error("交互列表无效或超过预算"); }
	for(let Index = 0; Index < Value.length; Index++)
	{
		const D = Object.getOwnPropertyDescriptor(Value, String(Index));
		if(!D || !Object.hasOwn(D, "value")) { throw Error("交互列表不能缺项或包含访问器"); }
	}
	return Value;
}
