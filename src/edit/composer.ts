export type ComposeAction = "question" | "edit";

export class ComposerActions
{
	readonly Question: HTMLButtonElement;
	readonly Preview: HTMLButtonElement;
	readonly Stop: HTMLButtonElement;
	constructor(Root: HTMLElement, Input: HTMLTextAreaElement, Submit: (Action: ComposeAction) => void, Stop: () => void)
	{
		this.Question = Root.createEl("button", { text: "提问", attr: { type: "button" } });
		this.Question.classList.add("mod-cta");
		this.Preview = Root.createEl("button", { text: "生成修改预览", attr: { type: "button" } });
		this.Stop = Root.createEl("button", { text: "停止", attr: { type: "button" } });
		this.Question.addEventListener("click", () => { if(!this.Question.disabled) { Submit("question"); } });
		this.Preview.addEventListener("click", () => { if(!this.Preview.disabled) { Submit("edit"); } });
		this.Stop.addEventListener("click", () => { if(!this.Stop.disabled) { Stop(); } });
		Input.addEventListener("keydown", Event =>
		{
			if(Event.key === "Enter" && !Event.shiftKey && !Event.isComposing && Event.keyCode !== 229 && !Event.defaultPrevented)
			{
				Event.preventDefault();
				if(!this.Question.disabled) { Submit("question"); }
			}
		});
	}
	refresh(Blocked: boolean, CanStop: boolean, Quoted: boolean): void
	{
		this.Question.disabled = Blocked;
		this.Preview.disabled = Blocked || Quoted;
		this.Stop.disabled = !CanStop;
	}
}
