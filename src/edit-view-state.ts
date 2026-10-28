import type { EditData } from "./edit/store";

// EditStore publishes a new immutable Data value only after the save succeeds.
// Keep large proposal/before/after text out of per-frame view signatures.
export class EditViewState
{
	private Data: EditData | undefined;
	private Keys = new Map<string, { Value: string; Text: unknown; Revision: number }>();
	private Sequence = 0;
	update(Data?: EditData): void
	{
		if(Data === this.Data) { return; } this.Data = Data;
		const Writes = new Map<string, unknown[]>(), Next = new Map<string, { Value: string; Text: unknown; Revision: number }>();
		for(const W of Data?.Writes ?? [])
		{
			const Values = Writes.get(W.TaskId) ?? []; Values.push([W.Id, W.State, W.Error, W.UndoPending]); Writes.set(W.TaskId, Values);
		}
		for(const R of Data?.Records ?? [])
		{
			const C = R.Cache, Value = JSON.stringify([R.Status, R.Error, C ? [C.Context, C.Armed, C.Remaining] : null, Writes.get(R.Spec.Id), Data?.CacheTurns]);
			const Previous = this.Keys.get(R.Spec.Id), Text = R.Output?.markdown;
			Next.set(R.Spec.Id, { Value, Text, Revision: Previous?.Value === Value && Previous.Text === Text ? Previous.Revision : ++this.Sequence });
		}
		this.Keys = Next;
	}
	key(TaskId: string): number { return this.Keys.get(TaskId)?.Revision ?? 0; }
}
