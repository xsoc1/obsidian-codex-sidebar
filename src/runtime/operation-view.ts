import type { SendOperation } from "../sync/types";
import type { SendIntent } from "./outbox";

export type OperationView = Pick<SendOperation, "Status" | "Error" | "TurnId" | "Attempted">;
export class OperationViewIndex
{
	private Operations?: readonly SendOperation[];
	private Intents?: readonly SendIntent[];
	private OperationLength = -1;
	private IntentLength = -1;
	private ById = new Map<string, SendOperation>();
	private IntentById = new Map<string, SendIntent>();
	get(Id: string, Operations: readonly SendOperation[] = [], Intents: readonly SendIntent[] = []): OperationView | null
	{
		if(this.Operations !== Operations || this.OperationLength !== Operations.length)
		{
			this.Operations = Operations; this.OperationLength = Operations.length; this.ById = new Map(Operations.map(O => [O.Id, O]));
		}
		if(this.Intents !== Intents || this.IntentLength !== Intents.length)
		{
			this.Intents = Intents; this.IntentLength = Intents.length; this.IntentById = new Map(Intents.map(O => [O.Id, O]));
		}
		const O = this.ById.get(Id), I = O ? undefined : this.IntentById.get(Id);
		return O ? { Status: O.Status, Error: O.Error, TurnId: O.TurnId, Attempted: O.Attempted } : I ? { Status: I.Status, Error: I.Error, Attempted: false } : null;
	}
	invalidate(): void { this.Operations = undefined; this.Intents = undefined; }
}
