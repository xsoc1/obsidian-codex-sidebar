import type { WriteTarget } from "./task";

export interface WritePlan
{
	Id: string;
	TaskId: string;
	Target: WriteTarget;
	After: string;
	Rationale: string;
	State: "preview" | "pending" | "applied" | "undone" | "conflict";
	Error?: string;
	UndoPending?: boolean;
}
export interface LocalStorageLike
{
	getItem(Key: string): string | null;
	setItem(Key: string, Value: string): void;
}
