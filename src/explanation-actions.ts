import type { AnswerQuote } from "./prompt";
import type { ChatMessage } from "./history";
import { text_identity } from "./markdown-blocks";

export const ExplanationActions = [
	{ Id: "step", Label: "展开这一步", Question: "请展开所选这一步: 写清省略的中间推导、每步依据及所用条件, 沿用原有证明路线与符号." },
	{ Id: "example", Label: "举个例子", Question: "请为所选内容给一个本学科中最小而完整的具体例子, 说明它如何对应原说明; 示例不冒充一般证明." },
	{ Id: "plain", Label: "说通俗些", Question: "请把所选内容说得更通俗: 先用简短直白的语言解释核心关系, 再对应回原符号, 保留关键条件, 不引入不必要的新概念." }
] as const;
export type ExplanationAction = typeof ExplanationActions[number]["Id"];

export function explanation_question(Action: ExplanationAction): string
{
	const Choice = ExplanationActions.find(A => A.Id === Action);
	if(!Choice) { throw Error("未知的解释动作"); }
	return Choice.Question + " 先解释选段, 再把补充放回原逻辑位置, 给出整合后的完整说明. 不写笔记.";
}

export function explanation_draft(Action: ExplanationAction, Quote: AnswerQuote, Session: string, Messages: readonly ChatMessage[], Draft: string, ExistingQuote: AnswerQuote | null): { Question: string; Quote: AnswerQuote }
{
	const Question = explanation_question(Action);
	if(Draft.trim() || ExistingQuote) { throw Error("请先处理当前草稿或引用, 再带入选段解释"); }
	const Original = Messages.find(M => M.Id === Quote.MessageId && M.Role === "assistant");
	if(Quote.SessionId !== Session || !Original || !Quote.SourceVersion || Quote.SourceVersion !== text_identity(Original.Text)) { throw Error("原回答或会话已变化, 请重新选择; 未更换来源"); }
	if(Quote.SourceStatus !== "completed" || !Quote.SelectedText.trim()) { throw Error("请在完整回答中选择要解释的内容"); }
	return { Question, Quote: structuredClone(Quote) };
}

/** A temporary, non-layout-shifting toolbar; selection and focus stay with the reader. */
export class ExplanationActionBar
{
	private Element: HTMLDivElement;
	private Quote: AnswerQuote | null = null;
	constructor(private Root: HTMLElement, private Choose: (Action: ExplanationAction, Quote: AnswerQuote) => void)
	{
		const Doc = Root.ownerDocument;
		this.Element = Doc.createElement("div"); this.Element.className = "codex-explanation-actions"; this.Element.hidden = true;
		this.Element.setAttribute("role", "group");
		const Label = Doc.createElement("span"); Label.id = "codex-explanation-" + crypto.randomUUID(); Label.textContent = "解释选段";
		this.Element.setAttribute("aria-labelledby", Label.id); this.Element.append(Label);
		for(const Choice of ExplanationActions)
		{
			const Button = Doc.createElement("button"); Button.type = "button"; Button.textContent = Choice.Label;
			Button.addEventListener("click", () => { const Quote = this.Quote; if(Quote) { this.hide(); this.Choose(Choice.Id, Quote); } });
			this.Element.append(Button);
		}
		const Close = Doc.createElement("button"); Close.type = "button"; Close.className = "codex-explanation-close"; Close.textContent = "收起"; Close.addEventListener("click", () => this.hide()); this.Element.append(Close);
		this.Element.addEventListener("pointerdown", Event => Event.preventDefault());
		Root.append(this.Element);
	}

	show(Quote: AnswerQuote | null, Rect?: DOMRect): void
	{
		if(!Quote || Quote.SourceStatus !== "completed" || !Rect || !Rect.width && !Rect.height) { this.hide(); return; }
		this.Quote = structuredClone(Quote); this.Element.hidden = false;
		const Bounds = this.Root.getBoundingClientRect(), Width = Math.max(0, Math.min(430, Bounds.width - 16));
		this.Element.style.width = Width + "px";
		this.Element.style.left = Math.max(Bounds.left + 8, Math.min(Rect.left, Bounds.right - Width - 8)) + "px";
		const Height = this.Element.getBoundingClientRect().height, WindowHeight = this.Root.ownerDocument.defaultView!.innerHeight;
		this.Element.style.top = Math.max(8, Math.min(Rect.bottom + 6, WindowHeight - Height - 8)) + "px";
	}
	hide(): void { this.Quote = null; this.Element.hidden = true; }
	dispose(): void { this.hide(); this.Element.remove(); }
}
