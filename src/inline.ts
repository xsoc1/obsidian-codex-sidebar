import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import type { CompletionInput } from "./completion";

export interface Suggestion
{
	Position: number;
	Text: string;
}

export const SetSuggestion = StateEffect.define<Suggestion | null>();

class GhostWidget extends WidgetType
{
	constructor(private Text: string)
	{
		super();
	}

	eq(Other: GhostWidget): boolean
	{
		return Other.Text === this.Text;
	}

	get lineBreaks(): number
	{
		return this.Text.split("\n").length - 1;
	}

	toDOM(View: EditorView): HTMLElement
	{
		const ElementValue = View.dom.ownerDocument.createElement("span");
		ElementValue.className = "codex-inline-ghost";
		ElementValue.textContent = this.Text;
		ElementValue.title = "在 Codex 侧栏确认插入, Esc 取消";
		ElementValue.setAttribute("aria-label", "Codex 补全建议, 在侧栏确认插入");
		return ElementValue;
	}
}

export const SuggestionField = StateField.define<Suggestion | null>(
{
	create: () => null,
	update: (Value, TransactionValue) =>
	{
		if(TransactionValue.docChanged || TransactionValue.selection)
		{
			Value = null;
		}
		for(const Effect of TransactionValue.effects)
		{
			if(Effect.is(SetSuggestion))
			{
				Value = Effect.value;
			}
		}
		const Selection = TransactionValue.state.selection;
		return Value?.Text && Selection.ranges.length === 1 && Selection.main.empty && Selection.main.head === Value.Position ? Value : null;
	},
	provide: Field => EditorView.decorations.from(Field, Value => Value ? Decoration.set([Decoration.widget({ widget: new GhostWidget(Value.Text), side: 1 }).range(Value.Position)]) : Decoration.none)
});

export function accept_suggestion(View: EditorView): boolean
{
	const Value = View.state.field(SuggestionField, false);
	if(!Value || View.composing || View.compositionStarted)
	{
		return false;
	}
	View.dispatch({ changes: { from: Value.Position, insert: Value.Text }, selection: { anchor: Value.Position + Value.Text.length }, effects: SetSuggestion.of(null), userEvent: "input.codex" });
	return true;
}

interface InlineOptions
{
	Enabled: () => boolean;
	Delay: () => number;
	Path: (View: EditorView) => string | null;
	Request: (Input: CompletionInput, Signal: AbortSignal) => Promise<string>;
	Status: (Text: string) => void;
	Changed: () => void;
}

interface Pending
{
	Timer?: ReturnType<typeof setTimeout>;
	Abort?: AbortController;
	Version: number;
	OfferPath?: string;
}

export class InlineCompletions
{
	Extension: Extension;
	private Views = new Map<EditorView, Pending>();

	constructor(private Options: InlineOptions)
	{
		const Owner = this;
		this.Extension = [SuggestionField, Prec.highest(keymap.of([
			{ key: "Escape", run: View => Owner.dismiss(View) },
			{ key: "Ctrl-Alt-Space", run: View => Owner.request(View) }
		])), ViewPlugin.fromClass(class
		{
			constructor(private View: EditorView)
			{
				Owner.Views.set(View, { Version: 0 });
			}

			update(Update: ViewUpdate): void
			{
				if(Update.docChanged || Update.selectionSet || (Update.focusChanged && !Update.view.hasFocus))
				{
					Owner.cancel(Update.view);
				}
				if(Update.startState.field(SuggestionField) !== Update.state.field(SuggestionField))
				{
					Owner.Options.Changed();
				}
				if(Update.docChanged && Update.transactions.some(Value => Value.isUserEvent("input") && !Value.isUserEvent("input.codex") && !Value.isUserEvent("input.paste")))
				{
					Owner.schedule(Update.view);
				}
			}

			destroy(): void
			{
				Owner.cancel(this.View);
				Owner.Views.delete(this.View);
			}
		}, { eventHandlers:
		{
			compositionstart(Event, View)
			{
				Owner.dismiss(View);
			},
			compositionend(Event, View)
			{
				Owner.schedule(View);
			}
		} })];
	}

	clear(): void
	{
		for(const View of this.Views.keys())
		{
			this.dismiss(View);
		}
	}

	get_suggestion(): { View: EditorView; Path: string; Text: string } | null
	{
		for(const [View, PendingValue] of this.Views)
		{
			const Value = View.state.field(SuggestionField, false);
			const Path = this.Options.Path(View);
			if(Value && Path && Path === PendingValue.OfferPath && View.dom.isConnected)
			{
				return { View, Path, Text: Value.Text };
			}
		}
		return null;
	}

	accept(View: EditorView): boolean
	{
		const PendingValue = this.Views.get(View);
		if(!PendingValue || this.Options.Path(View) !== PendingValue.OfferPath || !View.dom.isConnected)
		{
			return false;
		}
		const Accepted = accept_suggestion(View);
		if(Accepted)
		{
			this.Options.Status("Codex 补全已插入");
		}
		return Accepted;
	}

	dismiss_suggestion(View: EditorView): void
	{
		this.dismiss(View);
		this.Options.Status("Codex 补全已取消");
	}

	private cancel(View: EditorView): void
	{
		const PendingValue = this.Views.get(View);
		if(!PendingValue)
		{
			return;
		}
		PendingValue.Version++;
		const HasWork = !!(PendingValue.Timer || PendingValue.Abort);
		clearTimeout(PendingValue.Timer);
		PendingValue.Timer = undefined;
		PendingValue.Abort?.abort();
		PendingValue.Abort = undefined;
		if(HasWork)
		{
			this.Options.Status("Codex 补全已取消");
		}
	}

	private dismiss(View: EditorView): boolean
	{
		const PendingValue = this.Views.get(View);
		if(!PendingValue)
		{
			return false;
		}
		const HasWork = !!(PendingValue?.Timer || PendingValue?.Abort || View.state.field(SuggestionField, false));
		this.cancel(View);
		if(View.state.field(SuggestionField, false))
		{
			View.dispatch({ effects: SetSuggestion.of(null) });
		}
		return HasWork;
	}

	private schedule(View: EditorView): void
	{
		if(!this.Options.Enabled() || !View.hasFocus)
		{
			return;
		}
		const PendingValue = this.Views.get(View);
		if(PendingValue)
		{
			clearTimeout(PendingValue.Timer);
			PendingValue.Timer = setTimeout(() => this.request(View), this.Options.Delay());
		}
	}

	request(View: EditorView): boolean
	{
		if(!this.Options.Enabled() || !View.hasFocus || View.composing || View.compositionStarted || View.state.selection.ranges.length !== 1 || !View.state.selection.main.empty)
		{
			return false;
		}
		const Path = this.Options.Path(View);
		const PendingValue = this.Views.get(View);
		if(!Path || !PendingValue)
		{
			return false;
		}
		this.dismiss(View);
		const Doc = View.state.doc;
		const Position = View.state.selection.main.head;
		const Before = Doc.sliceString(Math.max(0, Position - 6000), Position);
		if(Before.trim().length < 3)
		{
			return false;
		}
		const Abort = new AbortController();
		PendingValue.Abort = Abort;
		const Version = PendingValue.Version;
		this.Options.Status("Codex 补全中...");
		void this.Options.Request({ Path, Before, After: Doc.sliceString(Position, Math.min(Doc.length, Position + 2000)) }, Abort.signal).then(Text =>
		{
			if(!Abort.signal.aborted && Version === PendingValue.Version && this.Options.Enabled() && View.hasFocus && !View.composing && !View.compositionStarted && View.state.doc === Doc && View.state.selection.main.head === Position && this.Options.Path(View) === Path)
			{
				if(Text)
				{
					PendingValue.OfferPath = Path;
					View.dispatch({ effects: SetSuggestion.of({ Position, Text }) });
				}
				this.Options.Status(Text ? "Codex: 在侧栏确认插入, Esc 取消" : "Codex: 暂无补全");
			}
		}).catch(ErrorValue =>
		{
			if(!Abort.signal.aborted)
			{
				this.Options.Status(`Codex 补全失败: ${ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue)}`);
			}
		}).finally(() =>
		{
			if(PendingValue.Abort === Abort)
			{
				PendingValue.Abort = undefined;
			}
		});
		return true;
	}
}
