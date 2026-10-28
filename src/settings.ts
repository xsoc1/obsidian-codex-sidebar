import { PluginSettingTab, Setting, Notice, Platform, Modal, type Plugin, type App } from "obsidian";
import type { SidebarOwner } from "./view-owner";
import { DefaultInstructions } from "./prompt";
import { EditScopeOptions, edit_scope } from "./edit/options";
import { export_edits } from "./edit/panel";
import { error_text } from "./ui-helpers";

export class CodexSettings extends PluginSettingTab
{
	constructor(AppValue: App, private Owner: SidebarOwner & Plugin)
	{
		super(AppValue, Owner);
	}

	display(): void
	{
		this.containerEl.empty();
		this.containerEl.createEl("h2", { text: "Codex Sidebar" });
		new Setting(this.containerEl).setName("环境检查").setDesc("检查完整运行包、登录、模型目录、math-writing、Obsidian 当前库与远程能力, 不自动发起推理或修改配置.").addButton(Button => Button.setButtonText("开始检查").onClick(async () =>
		{
			Button.setDisabled(true); try { await this.Owner.diagnose_environment(); } finally { Button.setDisabled(false); }
		}));
		const Notes = this.Owner.NoteSessions;
		new Setting(this.containerEl).setName("完整会话备份").setDesc("读取当前连接的全部历史及操作凭证后导出 JSON, 包含原文与冲突决议. 读取失败时不生成不完整备份; 配对密钥不包含在导出中.").addButton(Button => Button.setButtonText("导出会话").onClick(async () =>
		{
			Button.setDisabled(true);
			try
			{
				const Text = await this.Owner.export_conversations(), Dialog = new Modal(this.app);
				Dialog.contentEl.createEl("h3", { text: "完整会话导出" });
				Dialog.contentEl.createEl("p", { text: "包含聊天、来源与操作证据, 请保存在私人位置. 此导出不包含设备修改数据库与 PDF 图片字节." });
				const Save = Dialog.contentEl.createEl("button", { text: "下载 JSON", attr: { type: "button" } });
				Save.addEventListener("click", () =>
				{
					const Url = URL.createObjectURL(new Blob([Text], { type: "application/json;charset=utf-8" }));
					const Link = Dialog.contentEl.createEl("a", { attr: { href: Url, download: "codex-conversations.json" } }); Link.click(); Link.remove(); setTimeout(() => URL.revokeObjectURL(Url), 1000);
				}); Dialog.open();
			}
			catch(E) { new Notice(error_text(E)); }
			finally { Button.setDisabled(false); }
		}));
		const NoteError = this.Owner.NoteSessionError || Notes?.Error;
		new Setting(this.containerEl).setName("随笔记切换会话").setDesc(NoteError || "打开 Markdown 笔记或 PDF 时切换到对应会话. 已有会话和关联保留; 有草稿或正在回复时等待当前操作结束.")
			.addToggle(Toggle => Toggle.setValue(!!Notes?.Data.Enabled).setDisabled(!Notes).onChange(async Value =>
			{
				try { await this.Owner.set_note_sessions(Value); }
				catch(ErrorValue) { this.Owner.NoteSessionError = error_text(ErrorValue); new Notice(error_text(ErrorValue)); }
				this.display();
			}));
		new Setting(this.containerEl).setName("修改范围").setDesc("用于新发起的“生成修改预览”. 原文类型由 AI 辨识; 已发送任务重发时保留原范围. 采用修改前仍需确认差异.")
			.addDropdown(Dropdown =>
			{
				for(const [Value, Label] of EditScopeOptions) { Dropdown.addOption(Value, Label); }
				Dropdown.setValue(edit_scope(this.Owner.State.Settings.EditScope)).onChange(async Value =>
				{
					this.Owner.State.Settings.EditScope = edit_scope(Value);
					await this.Owner.persist();
				});
			});
		new Setting(this.containerEl).setName("独立远程连接").setDesc("iPad 使用独立后台 Codex 进程和会话记录. 桌面本机会话单独保留.").addToggle(Toggle => Toggle.setValue(this.Owner.Remote.Enabled).setDisabled(Platform.isMobileApp).onChange(async Value =>
		{
			try
			{
				await this.Owner.set_remote_mode(Value);
				this.display();
			}
			catch(ErrorValue)
			{
				new Notice(error_text(ErrorValue));
			}
		}));
		let RemoteUrl = this.Owner.Remote.Url;
		let RemoteToken = this.Owner.Remote.Token;
		let RemoteTransport = this.Owner.Remote.Transport ?? "browser";
		new Setting(this.containerEl).setName("远程服务地址").setDesc("填写电脑私有 HTTPS 地址. 地址与密钥只保存在此设备, 不写入同步的桌面设置.").addText(Value => Value.setValue(RemoteUrl).setPlaceholder("https://电脑地址:8445").onChange(Text => { RemoteUrl = Text.trim(); }));
		new Setting(this.containerEl).setName("配对密钥").addText(Value =>
		{
			Value.inputEl.type = "password";
			Value.setValue(RemoteToken).onChange(Text => { RemoteToken = Text.trim(); });
		});
		if(Platform.isMobileApp)
		{
			new Setting(this.containerEl).setName("移动网络传输").setDesc("浏览器请求超时时可手动切换原生请求, 绕过网页 CORS 预检. 两种方式都不自动重发; 原生请求超时后可能仍在服务端进行.").addDropdown(Value => Value.addOption("browser", "浏览器 Fetch").addOption("native", "Obsidian 原生请求").setValue(RemoteTransport).onChange(Text => { RemoteTransport = Text as "browser" | "native"; }));
		}
		new Setting(this.containerEl).setName("连接独立远程 Agent").addButton(Button => Button.setButtonText("保存并连接").onClick(async () =>
		{
			Button.setDisabled(true).setButtonText("连接中...");
			try
			{
				await this.Owner.configure_remote(RemoteUrl, RemoteToken, RemoteTransport);
				new Notice("独立远程会话已连接");
				this.display();
			}
			catch(ErrorValue)
			{
				this.Owner.Status = error_text(ErrorValue);
				this.Owner.refresh();
				new Notice(error_text(ErrorValue));
			}
			finally
			{
				Button.setDisabled(false).setButtonText("保存并连接");
			}
		}));
		new Setting(this.containerEl).setName("math-writing 技能").setDesc(`${this.Owner.SkillStatus}. 从${this.Owner.Remote.Enabled ? "Windows 服务端" : "本机"} Codex 的 skills/list 自动发现, 聊天与补全每次通过 skill 输入加载. 技能未安装或被禁用时明确报错; 不更改全局配置.`).addButton(Button => Button.setButtonText("重新检查").onClick(async () =>
		{
			try
			{
				await this.Owner.ensure_connection();
				this.Owner.MathWritingSkill = null;
				await this.Owner.ensure_math_skill();
			}
			catch(ErrorValue)
			{
				new Notice(error_text(ErrorValue));
			}
			this.display();
		}));
		new Setting(this.containerEl).setName("数学内容修改准则").setDesc("题目可判断并标注补充条件; 完整答案最小修补, 需推倒重来时先由你决定; 解题思路严格沿原路线证明; 模仿原稿语言. 固定随请求注入, 自定义工作提示词仍保留.");
		new Setting(this.containerEl).setName("修改与还原缓存保留轮数").setDesc("默认 1. 修改预览生成后, 或采用/安全还原后重新计时, 在同一会话后续完成 N 轮对话时清理对应预览和还原数据. 输入 1-1000 或“永不”. 未采用预览也会到期; 聊天和笔记保留, 旧记录不追溯清理. " + (this.Owner.Edits?.Cache.Error ?? "")).addText(Value => Value.setValue(this.Owner.Edits?.Cache.Turns === 0 ? "永不" : String(this.Owner.Edits?.Cache.Turns ?? 1)).setPlaceholder("1 或 永不").onChange(async Text =>
		{
			const Input = Text.trim(), Turns = ["永不", "never", "0"].includes(Input.toLowerCase()) ? 0 : /^\d+$/.test(Input) ? Number(Input) : NaN;
			if(!Number.isSafeInteger(Turns) || Turns < 0 || Turns > 1000) { Value.inputEl.setCustomValidity?.("输入 1-1000 或 永不"); return; }
			Value.inputEl.setCustomValidity?.("");
			try { await this.Owner.Edits?.Cache.set_turns(Turns); } catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
		}));
		let ConfirmEdits = false;
		new Setting(this.containerEl).setName("本设备修改记录").setDesc("普通聊天的修改提案、原文基线与撤销记录仅存本设备, 不随远程聊天覆盖. 导出含原文, 请自行保管. 清除后不能采用或安全撤销旧提案, 不会改动笔记.")
			.addButton(Button => Button.setButtonText("导出记录").onClick(() => { if(this.Owner.Edits) { export_edits(this.app, this.Owner.Edits.Store.export_records()); } }))
			.addButton(Button => Button.setButtonText("清除记录...").onClick(async () =>
			{
				if(!ConfirmEdits) { ConfirmEdits = true; Button.setButtonText("确认清除此设备记录"); return; }
				try { await this.Owner.Edits?.clear(); this.Owner.refresh(); new Notice("本设备修改记录已清除, 笔记未改动"); }
				catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
				this.display();
			}));
		let ConfirmClear = false;
		new Setting(this.containerEl).setName("PDF 页图缓存").setDesc("页图在当前设备单独保存, 远程桥按配对设备隔离. 清除会保留聊天和修改记录, 但缺少原图的请求不能重发. 不会删除 PDF 或撤回模型已收到的图片.").addButton(Button => Button.setButtonText("清除页图缓存...").onClick(async () =>
		{
			if(!ConfirmClear) { ConfirmClear = true; Button.setButtonText("确认清除本设备页图"); return; }
			Button.setDisabled(true);
			try { await this.Owner.clear_pdf_images(); new Notice(this.Owner.Status); }
			catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
			finally { this.display(); }
		}));
		new Setting(this.containerEl).setName("行内补全").setDesc("编辑停顿后显示灰色建议. 在侧栏确认插入, Esc 取消, Ctrl+Alt+Space 手动请求. 保留 Obsidian 原生 Tab. 自动请求会消耗 Codex 用量, 使用当前模型的 low 档次.").addToggle(Toggle => Toggle.setValue(this.Owner.State.Settings.Completion).onChange(Value => this.Owner.set_completion(Value)));
		new Setting(this.containerEl).setName("补全等待时间 (毫秒)").setDesc("默认 1200, 最小 500. 继续输入或移动光标会取消旧请求.").addText(TextValue => TextValue.setValue(String(this.Owner.State.Settings.CompletionDelay)).onChange(async Value =>
		{
			const Delay = Number(Value);
			if(Number.isFinite(Delay) && Delay >= 500 && Delay <= 30000)
			{
				this.Owner.State.Settings.CompletionDelay = Math.round(Delay);
				await this.Owner.persist();
			}
		}));
		if(!this.Owner.Remote.Enabled)
		{
			new Setting(this.containerEl).setName("Obsidian CLI 路径").setDesc("默认检测当前 Obsidian 安装的 Obsidian.com, 将实际路径和 vault 注入工作提示词. 也可填写自定义路径.").addText(TextValue => TextValue.setValue(this.Owner.State.Settings.ObsidianCliPath).onChange(async Value =>
			{
				this.Owner.State.Settings.ObsidianCliPath = Value.trim();
				await this.Owner.persist();
			}));
			new Setting(this.containerEl).setName("Codex 可执行文件").setDesc("留空时从 PATH 查找 codex.exe. 使用本机 Codex 登录.").addText(TextValue => TextValue
				.setValue(this.Owner.State.Settings.CliPath).setPlaceholder("C:\\...\\codex.exe").onChange(async Value =>
				{
					this.Owner.State.Settings.CliPath = Value.trim();
					await this.Owner.persist();
				}));
		}
		new Setting(this.containerEl).setName("模型与思考档次").setDesc("在侧栏直接选择. 选择状态自动保存, 收起后重开或重载插件都会恢复上次选择.");
		new Setting(this.containerEl).setName("内置工作提示词").setDesc("作为 Codex developer 消息注入会话, 保留其基础工具指令. 默认说明 Obsidian 阅读与研究工作及 Markdown/MathJax 渲染规则. 修改后在下一次发送更新当前会话.").addTextArea(TextValue =>
		{
			TextValue.inputEl.rows = 12;
			TextValue.inputEl.addClass("codex-instructions-input");
			TextValue.setValue(this.Owner.State.Settings.Instructions).onChange(async Value =>
			{
				this.Owner.State.Settings.Instructions = Value;
				await this.Owner.persist();
			});
		});
		new Setting(this.containerEl).setName("恢复默认工作提示词").addButton(Button => Button.setButtonText("恢复默认").onClick(async () =>
		{
			this.Owner.State.Settings.Instructions = DefaultInstructions;
			await this.Owner.persist();
			this.display();
		}));
		new Setting(this.containerEl).setName("自动捕获选区").setDesc("选中文字后更新上下文卡片. 点击快捷动作或发送按钮后提问.").addToggle(Toggle => Toggle
			.setValue(this.Owner.State.Settings.AutoCapture).onChange(async Value =>
			{
				this.Owner.State.Settings.AutoCapture = Value;
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("默认附带上下文").addToggle(Toggle => Toggle
			.setValue(this.Owner.State.Settings.AttachContext).onChange(async Value =>
			{
				this.Owner.State.Settings.AttachContext = Value;
				this.Owner.refresh();
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("重新连接").addButton(Button => Button.setButtonText("重连 Codex").onClick(() => void this.Owner.reconnect()));
	}
}
