export function error_text(ErrorValue: unknown): string
{
	return ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue);
}

export function accessible_name(ElementValue: HTMLElement, Text: string): void
{
	const Label = ElementValue.ownerDocument.createElement("span");
	Label.id = `codex-label-${crypto.randomUUID()}`;
	Label.className = "codex-sr-only";
	Label.textContent = Text;
	ElementValue.insertAdjacentElement("afterend", Label);
	ElementValue.setAttribute("aria-labelledby", Label.id);
}
