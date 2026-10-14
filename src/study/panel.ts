import { Component, MarkdownRenderer, Modal, Notice, type App } from "obsidian";
import type { ContextSnapshot } from "../prompt";
import { StudyController } from "./controller";
import { make_task } from "./task";
import type { InputRole, StudyAction } from "./schema";
import { bind_target } from "./writer";
import { block_ids, unit_range, version_of } from "./document";
import { parse_manifest, prerequisite_excerpt } from "./manifest";
import { exercise_markdown, latex_source, reading_markdown } from "./export";
import { diff_preview } from "./diff";
import { safe_math_markdown } from "./safe-markdown";

export interface PanelHost
{
	App: App;
	Study: StudyController;
	busy(): boolean;
	capture(): Promise<ContextSnapshot | null>;
	current(): ContextSnapshot | null;
	return_source(Path: string): Promise<void>;
}
export class StudyPanel
{
	private Body: HTMLElement;
	private SourceLabel: HTMLElement;
	private Role: HTMLSelectElement;
	private ManifestPath: HTMLInputElement;
	private Prerequisites: HTMLInputElement;
	private SectionId: HTMLInputElement;
	private Operation: HTMLSelectElement;
	private ProposalText: HTMLTextAreaElement;
	private ExerciseBody: HTMLElement;
	private Answer: HTMLTextAreaElement;
	private AnswerRole: HTMLSelectElement;
	private WritingBody: HTMLElement;
	private ReadingBody: HTMLElement;
	private ReviewBody: HTMLElement;
	private Dynamic: HTMLElement;
	private Status: HTMLElement;
	private Buttons: HTMLButtonElement[] = [];
	private Signature = "";
	private Render = new Component();
	private Closed = false;
	private ExportModals = new Set<Modal>();
	private Rendering = false;
	constructor(private Root: HTMLElement, private Host: PanelHost)
	{
		this.Render.load();
		Root.addClass("codex-study");
		const Tabs = Root.createDiv({ cls: "codex-study-actions" });
		for(const [Mode, Label] of [["reading", "伴读"], ["exercise", "练习"], ["writing", "写作"], ["review", "复习 / 导出"]] as const)
		{
			this.button(Tabs, Label, () =>
			{
				this.Host.Study.answer_focus(false);
				this.Host.Study.Store.change(Data => Data.Mode = Mode); this.refresh();
			});
		}
		this.Status = Root.createDiv({ cls: "codex-study-status", attr: { "aria-live": "polite" } });
		this.Body = Root.createDiv();
		this.SourceLabel = this.Body.createDiv({ cls: "codex-study-source" });
		const TargetActions = this.Body.createDiv({ cls: "codex-study-actions" });
		this.button(TargetActions, "重新捕获", () => this.recapture());
		this.button(TargetActions, "固定本段", async () =>
		{
			const Snapshot = this.Host.current() ?? await this.Host.capture();
			if(!Snapshot)
			{
				throw new Error("请先在正文选择一段或捕获阅读位置");
			}
			this.Host.Study.Store.change(Data => Data.Pinned = structuredClone(Snapshot)); this.refresh();
		});
		this.button(TargetActions, "跟随当前位置", () =>
		{
			this.Host.Study.Store.change(Data => Data.Pinned = null); this.refresh();
		});
		const Configuration = this.Body.createEl("details"); Configuration.createEl("summary", { text: "来源清单与输入角色" });
		this.Role = this.select(Configuration, "输入角色", [["source-excerpt", "参考材料 / 源书摘录 (默认只读)"], ["lecture", "讲义正文 (可生成待审提案)"], ["problem", "题目文本"], ["complete-answer", "完整答案"], ["outline", "解题思路"], ["teacher-problem", "教师原题 (只读)"]]);
		this.Role.value = this.Host.Study.Store.Data.InputRole ?? "source-excerpt";
		this.Role.addEventListener("change", () => this.Host.Study.Store.change(Data => Data.InputRole = this.Role.value as InputRole));
		this.ManifestPath = this.input(Configuration, "可选课程清单路径", this.Host.Study.Store.Data.Manifest?.Path ?? "");
		this.button(Configuration, "加载 .study.json", () => this.load_manifest());
		const PrereqLabel = Configuration.createEl("label");
		this.Prerequisites = PrereqLabel.createEl("input", { type: "checkbox" }); PrereqLabel.createSpan({ text: "加入清单中直接前置 (最多 3 段)" });
		this.ReadingBody = this.Body.createDiv();
		const ReadingActions = this.ReadingBody.createDiv({ cls: "codex-study-actions" });
		for(const [Action, Label, Request] of [["explain", "解释本段", "直接解释本段, 给出方法用途与必要的前置定义."], ["symbols", "说明符号", "说明本段各符号的输入、输出类型及一次实际取值或计算."], ["expand", "展开这一步", "沿原路线展开选中的这一步, 写清条件和非平凡理由."], ["check", "检查论证", "检查假设、量词和实际逻辑, 仅提出最小修补."], ["exercise", "相近练习", "从本段已完成的定义、算例或证明派生一道相近练习. 提示逐级, 给完整解答或明确 null." ]] as const)
		{
			this.button(ReadingActions, Label, () => this.request(Action, Request), true);
		}
		const Proposal = this.ReadingBody.createEl("details"); Proposal.createEl("summary", { text: "待审补充建议" });
		this.SectionId = this.input(Proposal, "待审补充: 单元块 ID", "");
		this.Operation = this.select(Proposal, "修改范围", [["insert-after", "指定单元之后插入"], ["replace-unit", "替换指定单元"]]);
		this.ProposalText = this.area(Proposal, "待审补充要求", "说明学习中发现的具体缺口");
		this.button(Proposal, "生成待审补充", () => this.proposal(), true);
		this.ExerciseBody = this.Body.createDiv();
		this.AnswerRole = this.select(this.ExerciseBody, "作答类型", [["complete-answer", "完整作答 / 局部尝试"], ["outline", "解题思路 (沿原路线反馈)"]]);
		this.AnswerRole.addEventListener("change", () =>
		{
			const Id = this.Answer.dataset.exerciseId;
			if(Id)
			{
				this.Host.Study.Store.change(Data => Data.Exercises.find(Value => Value.Id === Id)!.DraftRole = this.AnswerRole.value as "complete-answer" | "outline");
			}
		});
		this.ExerciseBody.addEventListener("focusin", () => this.Host.Study.answer_focus(true));
		this.ExerciseBody.addEventListener("focusout", Event =>
		{
			if(!Event.relatedTarget || !this.ExerciseBody.contains(Event.relatedTarget as Node))
			{
				this.Host.Study.answer_focus(false);
			}
		});
		this.Answer = this.area(this.ExerciseBody, "我的尝试 (作答期间暂停补全)", "写下你的计算或论证, 可使用其他正确解法");
		this.Answer.addEventListener("focus", () => this.Host.Study.answer_focus(true));
		this.Answer.addEventListener("blur", () => { this.Host.Study.answer_focus(false); this.refresh(); });
		this.Answer.addEventListener("input", () =>
		{
			const Id = this.Answer.dataset.exerciseId;
			if(Id)
			{
				this.Host.Study.Store.change(Data => Data.Exercises.find(Value => Value.Id === Id)!.Draft = this.Answer.value);
			}
		});
		const ExerciseActions = this.ExerciseBody.createDiv({ cls: "codex-study-actions" });
		this.button(ExerciseActions, "提交尝试 / 反馈", () => this.Host.Study.attempt(this.Answer.value, this.Answer.dataset.exerciseId, this.AnswerRole.value as "complete-answer" | "outline"), true);
		this.button(ExerciseActions, "下一层提示", () => this.Host.Study.hint());
		this.button(ExerciseActions, "查看完整答案", () => this.Host.Study.reveal(), true);
		this.button(ExerciseActions, "返回正文", async () =>
		{
			this.Host.Study.answer_focus(false);
			const Source = this.Host.Study.Exercise?.Source ?? this.source();
			if(Source)
			{
				await this.Host.return_source(Source.Path);
			}
			this.Host.Study.Store.change(Data => Data.Mode = "reading"); this.refresh();
		});
		this.WritingBody = this.Body.createDiv();
		const Writing = this.Host.Study.Store.Data.Writing;
		for(const [Key, Label] of [["Sources", "指定来源"], ["Endpoint", "目标终点与读者先修 / 运算熟练度"], ["Spine", "组织主线"], ["ContentMap", "原内容去向: 保留 / 展开 / 选读 / 省略"], ["Path", "新稿路径 (已有父目录, 默认不覆盖)"]] as const)
		{
			const Input = this.input(this.WritingBody, Label, Writing[Key]);
			Input.addEventListener("input", () => this.Host.Study.Store.change(Data =>
			{
				Data.Writing[Key] = Input.value;
				if(Key !== "Path")
				{
					delete Data.Writing.ApprovedSample; delete Data.Writing.ApprovedSampleId;
				}
			}));
		}
		this.button(this.WritingBody, "生成一节完整样章", () => this.writing(false), true);
		this.button(this.WritingBody, "确认样章组织, 允许逐节继续", () =>
		{
			const Sample = [...this.Host.Study.Store.Data.Tasks].reverse().find(Value => Value.Spec.Action === "sample" && Value.Status === "complete");
			if(!Sample?.Response)
			{
				throw new Error("尚无通过格式校验的完整样章");
			}
			if(["Sources", "Endpoint", "Spine", "ContentMap"].some(Key => (Sample.Spec.Writing as any)?.[Key] !== (this.Host.Study.Store.Data.Writing as any)[Key]))
			{
				throw new Error("写作计划已变化, 请先生成对应的新样章");
			}
			this.Host.Study.Store.change(Data => { Data.Writing.ApprovedSample = Sample.Response; Data.Writing.ApprovedSampleId = Sample.Spec.Id; }); this.refresh();
		});
		this.button(this.WritingBody, "生成下一节 (新文件)", () => this.writing(true), true);
		this.ReviewBody = this.Body.createDiv();
		this.button(this.ReviewBody, "检查来源版本", () => this.Host.Study.check_versions());
		for(const [Label, Export] of [["导出学习记录 JSON", () => this.Host.Study.Store.export_records()], ["导出练习 Markdown", () => exercise_markdown(this.Host.Study.Store.Data.Exercises, false)], ["导出练习与解答 Markdown", () => exercise_markdown(this.Host.Study.Store.Data.Exercises, true)]] as const)
		{
			this.button(this.ReviewBody, Label, () => this.download(Label.includes("JSON") ? "study-records.json" : "study-exercises.md", Export()));
		}
		this.button(this.ReviewBody, "导出当前正文 Markdown", () => this.export_source(false));
		this.button(this.ReviewBody, "导出支持结构的 LaTeX 源码", () => this.export_source(true));
		const Clear = this.input(this.ReviewBody, "清除练习、尝试、提示与任务: 输入 清除", "");
		this.button(this.ReviewBody, "确认清除本设备学习记录", () =>
		{
			if(Clear.value !== "清除")
			{
				throw new Error("请输入 清除 后确认");
			}
			this.Host.Study.Store.clear_records(); this.Host.Study.Error = ""; Clear.value = ""; this.Signature = ""; this.refresh();
		});
		this.Dynamic = this.Body.createDiv({ cls: "codex-study-results" });
		this.refresh();
	}
	private source(): ContextSnapshot | null
	{
		return this.Host.Study.Store.Data.Pinned ?? this.Host.current();
	}
	private async recapture(): Promise<void>
	{
		const Snapshot = await this.Host.capture();
		if(!Snapshot)
		{
			throw new Error("没有可捕获的正文");
		}
		if(this.Host.Study.Store.Data.Pinned)
		{
			this.Host.Study.Store.change(Data => Data.Pinned = structuredClone(Snapshot));
		}
		this.refresh();
	}
	private async task(Action: StudyAction, Request: string)
	{
		const Source = this.Host.Study.Store.Data.Pinned ?? await this.Host.capture() ?? this.Host.current();
		if(!Source)
		{
			throw new Error("请先捕获一段正文");
		}
		const Task = make_task(Action, Source, Request, this.Role.value as InputRole);
		Task.SourceVersion = Source.Version ?? "unknown";
		const Manifest = this.Host.Study.Store.Data.Manifest?.Data;
		const Units = Manifest?.units.filter(Value => Value.path === Source.Path) ?? [];
		const SourceText = Units.length ? await this.Host.Study.Host.read_current(Source.Path) : null;
		const Unit = Units.find(Value =>
		{
			if(Value.blockId === this.SectionId.value.trim())
			{
				return true;
			}
			if(SourceText && Source.LineStart !== null)
			{
				const Range = unit_range(SourceText, Value.blockId);
				const Start = SourceText.slice(0, Range.From).split("\n").length - 1;
				const End = SourceText.slice(0, Range.To).split("\n").length - 1;
				const Focus = Source.FocusLine ?? Source.LineStart;
				return Focus >= Start && Focus <= End;
			}
			return false;
		});
		if(Unit && (Unit.role !== "lecture" || Task.Role === "source-excerpt"))
		{
			Task.Role = Unit.role;
		}
		if(Unit && Manifest)
		{
			Task.Sources = Manifest.sources.filter(Value => Unit.sources.includes(Value.id)).map(Value => ({ Id: Value.id, Label: Value.label, Locator: Value.locator, Verification: Value.verification }));
		}
		if(Unit && this.Prerequisites.checked)
		{
			for(const Ref of Unit.prerequisites)
			{
				const Full = await this.Host.Study.Host.read_current(Ref.path);
				if(Full === null)
				{
					throw new Error("直接前置笔记不存在");
				}
				Task.Prerequisites.push({ ...Source, Path: Ref.path, Kind: "当前位置", SelectedText: "", Text: prerequisite_excerpt(Full, Ref.blockId), Mapping: "源块", LineStart: null, LineEnd: null, CapturedAt: new Date().toISOString(), Truncated: false });
			}
		}
		return Task;
	}
	private async request(Action: StudyAction, Request: string): Promise<void>
	{
		await this.Host.Study.send(await this.task(Action, Request)); this.refresh();
	}
	private async load_manifest(): Promise<void>
	{
		const Path = this.ManifestPath.value.trim();
		if(!Path.endsWith(".study.json") || /[\\:]|(?:^|\/)\./.test(Path))
		{
			throw new Error("清单路径必须是 vault 内 .study.json 文件");
		}
		const File = this.Host.App.vault.getFileByPath(Path);
		if(!File)
		{
			throw new Error("清单不存在");
		}
		const Manifest = parse_manifest(await this.Host.App.vault.read(File));
		this.Host.Study.Store.change(Data => Data.Manifest = { Path, Data: Manifest });
		for(const Unit of Manifest.units)
		{
			const Text = await this.Host.Study.Host.read_current(Unit.path);
			if(Text === null)
			{
				continue;
			}
			const Range = unit_range(Text, Unit.blockId);
			const Source: ContextSnapshot = { Path: Unit.path, Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text: Text.slice(Range.From, Range.To).slice(0, 24000), SelectedText: "", CapturedAt: new Date().toISOString(), LineStart: null, LineEnd: null, Heading: Unit.id, Truncated: Range.To - Range.From > 24000 };
			const Version = await version_of(Text);
			this.Host.Study.Store.change(Data =>
			{
				for(const Exercise of Unit.exercises)
				{
					const Id = `${Manifest.courseId}-${Exercise.id}`;
					if(!Data.Exercises.some(Value => Value.Id === Id))
					{
						Data.Exercises.push({ Id, Content: Exercise.content, Source, SourceVersion: Version, CreatedAt: Source.CapturedAt, Stale: false, HintUses: [], Reveals: [], Attempts: [], Draft: "" });
					}
					else
					{
						const Existing = Data.Exercises.find(Value => Value.Id === Id)!;
						Existing.ManifestVersionChanged = JSON.stringify(Existing.Content) !== JSON.stringify(Exercise.content);
						Existing.Stale = Existing.ManifestVersionChanged || Existing.SourceVersion !== Version;
					}
				}
			});
		}
		this.refresh();
	}
	private async proposal(): Promise<void>
	{
		const Task = await this.task("proposal", this.ProposalText.value);
		const DeclaredUnit = this.Host.Study.Store.Data.Manifest?.Data.units.find(Value => Value.path === Task.Source?.Path && Value.blockId === this.SectionId.value.trim());
		if(DeclaredUnit && DeclaredUnit.role !== "lecture")
		{
			throw new Error("清单中的源书与教师原题只读, 不生成写回提案");
		}
		if(Task.Role !== "lecture" || !Task.Source || !this.ProposalText.value.trim())
		{
			throw new Error("只对明确的讲义正文补充请求生成提案; 其他角色保留最小修改边界");
		}
		Task.Target = await bind_target(this.Host.Study.Host, Task.Source.Path, this.Operation.value as "insert-after" | "replace-unit", this.SectionId.value.trim());
		const Range = unit_range(Task.Target.Before!, Task.Target.BlockId!);
		const UnitText = Task.Target.Before!.slice(Range.From, Range.To);
		if(UnitText.length > 24000)
		{
			throw new Error("目标单元超过 24000 字符, 请先划分较小单元");
		}
		Task.WriteUnit = { ...Task.Source, Text: UnitText, SelectedText: "", Mapping: "源块", Kind: "当前位置", Truncated: false, LineStart: Task.Target.Before!.slice(0, Range.From).split("\n").length - 1, LineEnd: Task.Target.Before!.slice(0, Range.To).split("\n").length - 1 };
		await this.Host.Study.send(Task); this.refresh();
	}
	private async writing(Next: boolean): Promise<void>
	{
		const Writing = this.Host.Study.Store.Data.Writing;
		if(!Writing.Sources.trim() || !Writing.Endpoint.trim() || !Writing.Spine.trim() || !Writing.ContentMap.trim() || (Next && !Writing.ApprovedSample))
		{
			throw new Error("请明确来源、终点、主线和内容去向; 逐节继续需先确认样章");
		}
		const Request = Next ? "依据已确认样章生成下一节完整正文, 不自动续写其他章节." : "明确请求新写/重编讲义: 先生成一节完整样章供审核, 默认新稿.";
		const Approved = Next ? this.Host.Study.Store.Data.Tasks.find(Value => Value.Spec.Id === Writing.ApprovedSampleId && Value.Status === "complete")?.Spec : null;
		if(Next && !Approved)
		{
			throw new Error("原样章任务不存在, 请重新审核样章");
		}
		const Task = Approved ? { ...structuredClone(Approved), Id: crypto.randomUUID(), Action: "chapter" as const, Request, CreatedAt: new Date().toISOString() } : await this.task("sample", Request);
		Task.Writing = structuredClone(Writing);
		Task.Target = await bind_target(this.Host.Study.Host, Writing.Path, "create", null);
		await this.Host.Study.send(Task); this.refresh();
	}
	refresh(): void
	{
		if(this.Closed)
		{
			return;
		}
		const Data = this.Host.Study.Store.Data;
		const Source = this.source();
		this.SourceLabel.setText(Source ? `${Data.Pinned ? "固定本段" : "跟随当前位置"}: ${Source.Path} / ${Source.Mapping} / ${Source.CapturedAt}${Source.Truncated ? " / 已截断" : ""}` : "选中正文或捕获阅读位置. 无清单可伴读与临时练习.");
		this.Status.setText(this.Host.Study.Error || (this.Host.busy() ? "使用现有 Codex 会话处理任务中" : Data.Manifest ? `课程: ${Data.Manifest.Data.title}` : "临时学习工作台"));
		this.ReadingBody.hidden = Data.Mode !== "reading";
		this.ExerciseBody.hidden = Data.Mode !== "exercise";
		this.WritingBody.hidden = Data.Mode !== "writing";
		this.ReviewBody.hidden = Data.Mode !== "review";
		this.Buttons = this.Buttons.filter(Button => Button.isConnected);
		this.Buttons.forEach(Button => { if(Button.dataset.model === "true") { Button.disabled = this.Host.busy(); } });
		const Exercise = this.Host.Study.Exercise;
		if(this.Root.ownerDocument.activeElement !== this.Answer && !this.Answer.matches(":focus"))
		{
			this.Answer.value = Exercise?.Draft ?? "";
			this.Answer.dataset.exerciseId = Exercise?.Id ?? "";
			this.AnswerRole.value = Exercise?.DraftRole ?? "complete-answer";
		}
		const Signature = JSON.stringify([Data.Mode, Data.Exercises, Data.ActiveExercise, Data.Writes, Data.Writing.ApprovedSample, Data.Tasks.map(Value => [Value.Spec.Id, Value.Status, Value.Error])]);
		if(this.Signature === Signature || this.Rendering || this.Root.ownerDocument.activeElement === this.Answer)
		{
			return;
		}
		this.Signature = Signature; this.Rendering = true;
		void this.render_dynamic().catch(ErrorValue => { this.Status.setText(String(ErrorValue)); }).finally(() => { this.Rendering = false; if(!this.Closed) { this.refresh(); } });
	}
	private async markdown(Parent: HTMLElement, Text: string, Path = ""): Promise<void>
	{
		if(!safe_math_markdown(Text)) { Parent.createEl("pre", { text: Text }); return; }
		await MarkdownRenderer.render(this.Host.App, Text, Parent, Path, this.Render);
	}
	private async render_dynamic(): Promise<void>
	{
		this.Render.unload(); this.Render = new Component(); this.Render.load(); this.Dynamic.empty();
		const Data = this.Host.Study.Store.Data;
		if(Data.Mode === "exercise")
		{
			const Exercise = this.Host.Study.Exercise;
			if(!Exercise)
			{
				this.Dynamic.createEl("p", { text: "先在伴读中生成相近练习, 或在复习中选择清单练习." });
			}
			else
			{
				this.Dynamic.createEl("p", { text: `${Exercise.Id} / 未独立数学核验${Exercise.Stale ? " / 原文版本已变化, 历史尝试保留" : ""}` });
				await this.markdown(this.Dynamic.createDiv(), Exercise.Content.statement, Exercise.Source.Path);
				for(const Use of Exercise.HintUses)
				{
					await this.markdown(this.Dynamic.createDiv(), `**提示 ${Use.Level}**\n\n${Exercise.Content.hints[Use.Level - 1]}`, Exercise.Source.Path);
				}
				if(Exercise.Reveals.length)
				{
					await this.markdown(this.Dynamic.createDiv(), "**完整答案 (未独立核验)**\n\n" + (Exercise.Content.solution ?? "尚无可靠解答; 可在现有对话中明确请求完整解答."), Exercise.Source.Path);
				}
				for(const Attempt of Exercise.Attempts)
				{
					await this.markdown(this.Dynamic.createDiv(), `**尝试 ${Attempt.At}**\n\n${Attempt.Text}\n\n` + (Attempt.Feedback ? `**AI 反馈: ${Attempt.Feedback.verdict}**\n\n${Attempt.Feedback.explanation}` : "反馈尚未完成, 可在会话中重发原任务."), Exercise.Source.Path);
				}
			}
		}
		if(Data.Mode === "review")
		{
			for(const Exercise of Data.Exercises)
			{
				this.button(this.Dynamic, `${Exercise.Id} (${Exercise.Attempts.length} 次尝试${Exercise.Stale ? ", 版本变化" : ""})`, () =>
				{
					this.Host.Study.Store.change(Data => { Data.ActiveExercise = Exercise.Id; Data.Mode = "exercise"; }); this.refresh();
				});
			}
		}
		for(const Plan of Data.Writes)
		{
			const Box = this.Dynamic.createEl("details", { cls: "codex-study-write" }); Box.open = ["preview", "conflict", "pending"].includes(Plan.State);
			Box.createEl("summary", { text: `${Plan.Target.Path} / ${Plan.Target.Operation} / ${Plan.State}` });
			Box.createEl("p", { text: `目标版本: ${Plan.Target.Version}; ${Plan.Rationale}. 格式通过, 数学未独立核验.` });
			Box.createEl("p", { text: Plan.Error ?? "确认前不会修改任何正文" });
			const Diff = Box.createEl("details"); Diff.open = true; Diff.createEl("summary", { text: "待采用差异 (- 删除 / + 增加)" });
			Diff.createEl("pre", { text: diff_preview(Plan.Target.Before, Plan.After) });
			await this.markdown(Box.createDiv({ cls: "codex-study-draft" }), Plan.After, Plan.Target.Path);
			if(["preview", "pending"].includes(Plan.State))
			{
				this.button(Box, "确认采用到当前客户端", async () => { await this.Host.Study.Writer.confirm(Plan.Id); this.refresh(); });
			}
			if(Plan.State === "applied" && Plan.Target.Before !== null)
			{
				this.button(Box, "安全撤销本次采用", async () => { await this.Host.Study.Writer.undo(Plan.Id); this.refresh(); });
			}
		}
		const Rejected = Data.Tasks.filter(Value => Value.Status === "rejected");
		if(Rejected.length)
		{
			this.Dynamic.createEl("p", { text: `最近未接纳的输出: ${Rejected.at(-1)!.Error}. 原始回答保留在会话中, 可编辑并重发原问题.` });
		}
	}
	private async export_source(Latex: boolean): Promise<void>
	{
		const Source = this.source();
		if(!Source)
		{
			throw new Error("没有正文目标");
		}
		const Text = await this.Host.Study.Host.read_current(Source.Path);
		if(Text === null)
		{
			throw new Error("正文不存在");
		}
		this.download(Latex ? "lecture.tex" : "lecture.md", Latex ? latex_source(Text) : reading_markdown(Text));
	}
	private download(Name: string, Text: string): void
	{
		const Dialog = new Modal(this.Host.App); this.ExportModals.add(Dialog);
		Dialog.contentEl.createEl("h2", { text: `导出: ${Name}` });
		const Area = this.area(Dialog.contentEl, "可复制的完整导出内容", ""); Area.value = Text; Area.readOnly = true;
		this.button(Dialog.contentEl, "复制全文", async () =>
		{
			if(navigator.clipboard?.writeText)
			{
				await navigator.clipboard.writeText(Text); new Notice("导出内容已复制");
			}
			else { Area.focus(); Area.select(); new Notice("请使用系统复制"); }
		});
		this.button(Dialog.contentEl, "下载文件", () =>
		{
			const Url = URL.createObjectURL(new Blob([Text], { type: "text/plain;charset=utf-8" }));
			const Link = Dialog.contentEl.createEl("a", { attr: { href: Url, download: Name } }); Link.click(); Link.remove();
			setTimeout(() => URL.revokeObjectURL(Url), 1000);
		});
		this.button(Dialog.contentEl, "关闭", () => { Dialog.close(); this.ExportModals.delete(Dialog); }); Dialog.open();
	}
	private input(Parent: HTMLElement, Label: string, Value: string): HTMLInputElement
	{
		const Container = Parent.createEl("label", { cls: "codex-study-field" }); Container.createSpan({ text: Label });
		return Container.createEl("input", { type: "text", value: Value });
	}
	private select(Parent: HTMLElement, Label: string, Choices: string[][]): HTMLSelectElement
	{
		const Container = Parent.createEl("label", { cls: "codex-study-field" }); Container.createSpan({ text: Label });
		const Select = Container.createEl("select"); Choices.forEach(([Value, Text]) => Select.createEl("option", { text: Text, value: Value })); return Select;
	}
	private area(Parent: HTMLElement, Label: string, Placeholder: string): HTMLTextAreaElement
	{
		const Container = Parent.createEl("label", { cls: "codex-study-field" }); Container.createSpan({ text: Label }); return Container.createEl("textarea", { attr: { placeholder: Placeholder } });
	}
	private button(Parent: HTMLElement, Label: string, Callback: () => unknown | Promise<unknown>, Model = false): HTMLButtonElement
	{
		const Button = Parent.createEl("button", { text: Label, attr: { type: "button" } }); Button.dataset.model = String(Model); this.Buttons.push(Button);
		Button.addEventListener("click", () =>
		{
			Button.disabled = true;
			void Promise.resolve().then(Callback).catch(ErrorValue => { this.Host.Study.Error = ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue); new Notice(this.Host.Study.Error); }).finally(() => { Button.disabled = Model && this.Host.busy(); this.refresh(); });
		});
		return Button;
	}
	close(): void
	{
		this.Closed = true; this.Host.Study.answer_focus(false); this.Render.unload();
		this.ExportModals.forEach(Dialog => Dialog.close()); this.ExportModals.clear();
	}
}
