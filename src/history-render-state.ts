import type { ChatMessage } from "./history";
import { followup_index } from "./history-view-state";
import { answer_sources, source_key, source_path, type SourceReference } from "./sources";

type Followups = ReturnType<typeof followup_index>;
interface Entry
{
	Index: number;
	Message: ChatMessage;
	Values: unknown[];
	Navigation: unknown[];
	Revision: number;
	Source?: { Path: string; Sources: SourceReference[]; Key: string };
}
const Values = (M: ChatMessage) => [M, M.Role, M.Text, M.TurnId, M.ContextLabel, M.Context, M.Quote, M.Task, M.Sources, M.CompletionStatus, M.Phase, M.OperationId, M.SyncVersion];
const Navigation = (M: ChatMessage) => [M.Role, M.TurnId, !!M.Text.trim(), M.Quote?.MessageId, M.Quote?.RootMessageId, M.Phase, M.CompletionStatus, M.OperationId];
const Same = (A: unknown[], B: unknown[]) => A.length === B.length && A.every((V, I) => V === B[I]);

// One index per warm conversation. The host invalidates IDs on in-place changes;
// bounded visible checks also support SDK clients without mutation notifications.
export class HistoryRenderState
{
	private Messages: readonly ChatMessage[] | null = null;
	private Count = 0;
	private Entries = new Map<string, Entry>();
	private Users = new Map<string, ChatMessage>();
	private Turns = new Map<string, Set<string>>();
	private Dirty = new Set<string>();
	private Reset = true;
	private NavigationDirty = true;
	private ActiveTurn: string | null | undefined;
	Followups: Followups = new Map();
	Revision = 0;
	readonly Stats = { ScannedMessages: 0, CheckedMessages: 0, SourceBuilds: 0, NavigationScans: 0 };
	invalidate(Ids?: readonly string[]): void
	{
		if(Ids) { for(const Id of Ids) { this.Dirty.add(Id); } }
		else { this.Reset = true; }
		this.Revision++;
	}
	prepare(Messages: readonly ChatMessage[], Visible: readonly ChatMessage[], ActiveTurn?: string | null): void
	{
		if(this.Reset || this.Messages !== Messages || Messages.length < this.Count)
		{
			this.Entries.clear(); this.Users.clear(); this.Turns.clear(); this.Count = 0; this.NavigationDirty = true; this.Reset = false;
		}
		this.Messages = Messages;
		for(let I = this.Count; I < Messages.length; I++) { this.add(Messages[I], I); }
		this.Count = Messages.length;
		for(const M of Visible)
		{
			this.Stats.CheckedMessages++;
			const E = this.Entries.get(M.Id);
			if(!E || !Same(E.Values, Values(M))) { if(E) { E.Message = M; } this.Dirty.add(M.Id); }
		}
		for(const Id of this.Dirty)
		{
			const E = this.Entries.get(Id); if(!E) { this.Reset = true; continue; }
			const M = Messages[E.Index];
			if(M?.Id !== Id) { this.Reset = true; continue; }
			E.Message = M; const Nav = Navigation(M);
			if(!Same(E.Navigation, Nav)) { this.NavigationDirty = true; }
			const OldTurn = E.Values[3] as string | undefined, OldMessage = E.Values[0] as ChatMessage;
			if(OldTurn !== M.TurnId)
			{
				if(OldTurn)
				{
					this.Turns.get(OldTurn)?.delete(Id);
					if(this.Users.get(OldTurn) === OldMessage) { this.Users.delete(OldTurn); }
					for(const Related of this.Turns.get(OldTurn) ?? []) { const R = this.Entries.get(Related)!; R.Source = undefined; R.Revision = ++this.Revision; }
				}
				if(M.TurnId) { const Turn = this.Turns.get(M.TurnId) ?? new Set<string>(); Turn.add(Id); this.Turns.set(M.TurnId, Turn); }
			}
			E.Values = Values(M); E.Navigation = Nav; E.Revision = ++this.Revision; E.Source = undefined;
			if(M.Role === "user" && M.TurnId)
			{
				this.Users.set(M.TurnId, M);
				for(const Related of this.Turns.get(M.TurnId) ?? [])
				{
					const R = this.Entries.get(Related)!; R.Source = undefined; R.Revision = ++this.Revision;
				}
			}
		}
		this.Dirty.clear();
		if(this.ActiveTurn !== ActiveTurn) { this.ActiveTurn = ActiveTurn; this.NavigationDirty = true; }
		if(this.NavigationDirty)
		{
			this.Followups = followup_index(Messages, ActiveTurn); this.Stats.NavigationScans += Messages.length; this.NavigationDirty = false;
		}
	}
	private add(M: ChatMessage, Index: number): void
	{
		this.Stats.ScannedMessages++;
		if(this.Entries.has(M.Id)) { throw Error("重复的消息标识"); }
		this.Entries.set(M.Id, { Index, Message: M, Values: Values(M), Navigation: Navigation(M), Revision: ++this.Revision });
		if(M.TurnId)
		{
			const Turn = this.Turns.get(M.TurnId) ?? new Set<string>(); Turn.add(M.Id); this.Turns.set(M.TurnId, Turn);
			if(M.Role === "user" && !this.Users.has(M.TurnId)) { this.Users.set(M.TurnId, M); }
		}
		this.NavigationDirty = true;
	}
	user(M: ChatMessage): ChatMessage | undefined { return M.Role === "user" ? M : M.TurnId ? this.Users.get(M.TurnId) : undefined; }
	version(Id: string): number { return this.Entries.get(Id)?.Revision ?? 0; }
	source(M: ChatMessage): { Path: string; Sources: SourceReference[]; Key: string }
	{
		const E = this.Entries.get(M.Id); if(E?.Source) { return E.Source; }
		const User = this.user(M), Bound = User ? [User] : [], Sources = answer_sources(Bound, M);
		const Result = { Path: source_path(Bound, M), Sources, Key: source_key(Sources) };
		if(E) { E.Source = Result; } this.Stats.SourceBuilds++; return Result;
	}
}
