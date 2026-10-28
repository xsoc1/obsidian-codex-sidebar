import { canonical_json, content_digest } from "../sync/types";
import { validate_outbox } from "./outbox";
import { deleted_messages } from "../sessions";

export interface StateFiles
{
	exists(Path: string): Promise<boolean>;
	read(Path: string): Promise<string>;
	write(Path: string, Text: string): Promise<void>;
}
const Baselines = new WeakMap<StateFiles, Map<string, string | null>>();
const Queues = new WeakMap<StateFiles, Map<string, Promise<void>>>();
const baseline = (Files: StateFiles): Map<string, string | null> => { let Map = Baselines.get(Files); if(!Map) { Map = new globalThis.Map(); Baselines.set(Files, Map); } return Map; };
const parse_state = (Raw: string): any => { const Value = JSON.parse(Raw); validate_saved_state(Value); return Value; };
const raw_file = async (Files: StateFiles, Path: string): Promise<string | null> => await Files.exists(Path) ? Files.read(Path) : null;
async function checked_write(Files: StateFiles, Path: string, Raw: string): Promise<void> { await Files.write(Path, Raw); if(await Files.read(Path) !== Raw) { throw new Error("文件读回不一致, 保留事务与原文件"); } }
interface SaveReceipt { SchemaVersion: 1; Status: "pending" | "committed"; Canonical: string; Staged: string; Backup: string; PreviousDigest: string; TargetDigest: string; }

async function recover_save(Files: StateFiles, Canonical: string): Promise<void>
{
	const Path = Canonical + ".save.journal.json";
	if(!await Files.exists(Path)) { return; }
	const Receipt: SaveReceipt = JSON.parse(await Files.read(Path)), Stage = Canonical + ".save.stage.json", Backup = Canonical + ".last-committed.json";
	if(Receipt.SchemaVersion !== 1 || !["pending", "committed"].includes(Receipt.Status) || Receipt.Canonical !== Canonical || Receipt.Staged !== Stage || Receipt.Backup !== Backup) { throw new Error("会话保存日志无效, 原文件保留"); }
	const Current = await raw_file(Files, Canonical);
	if(Receipt.Status === "committed") { if(Current === null) { throw new Error("已提交会话文件缺失, 保留最近已提交备份, 不回放旧迁移初稿"); } parse_state(Current); return; }
	const Target = await Files.read(Stage); parse_state(Target);
	if(await content_digest(Target) !== Receipt.TargetDigest) { throw new Error("待提交会话候选摘要不符, 保留双方"); }
	if(await content_digest(Current) !== Receipt.TargetDigest && Receipt.PreviousDigest !== await content_digest(null))
	{
		const Previous = await Files.read(Backup); parse_state(Previous); const Digest = await content_digest(Previous);
		if(Digest !== Receipt.PreviousDigest && Digest !== Receipt.TargetDigest) { throw new Error("最近已提交备份与事务不符, 保留当前文件和候选"); }
	}
	let Allowed = await content_digest(Current) === Receipt.PreviousDigest || await content_digest(Current) === Receipt.TargetDigest;
	if(!Allowed && Current !== null)
	{
		try { parse_state(Current); } catch
		{
			try { const V = JSON.parse(Current); if(V?.SchemaVersion !== undefined && V.SchemaVersion !== 2) { throw new Error("未来版本会话不能用旧候选覆盖"); } } catch(ErrorValue) { if(/未来版本/.test(String(ErrorValue))) { throw ErrorValue; } }
			Allowed = Target.startsWith(Current);
		}
	}
	if(!Allowed) { throw new Error("保存期间当前会话已发生并发变化, 保留当前文件、候选和备份, 不覆盖任何一方"); }
	if(Current !== Target) { await checked_write(Files, Canonical, Target); }
	await checked_write(Files, Backup, Target);
	await checked_write(Files, Path, JSON.stringify({ ...Receipt, Status: "committed" })); baseline(Files).set(Canonical, Target);
}
export function validate_saved_state(Value: any): void
{
	if(!Value || !Value.Settings || !Array.isArray(Value.Sessions) || !Value.Sessions.length || typeof Value.ActiveId !== "string" || (Value.SchemaVersion !== undefined && Value.SchemaVersion !== 2)) { throw new Error("会话文件版本或结构无效, 原文件保留"); }
	const Seen = new Set<string>();
	for(const Session of Value.Sessions)
	{
		if(!Session || typeof Session.Id !== "string" || !Session.Id || Seen.has(Session.Id) || !Array.isArray(Session.Messages)) { throw new Error("会话身份损坏, 未清空历史"); } Seen.add(Session.Id);
		const Messages = new Set<string>();
		for(const M of Session.Messages) { if(!M || typeof M.Id !== "string" || !M.Id || Messages.has(M.Id) || !["user", "assistant", "reasoning", "system"].includes(M.Role) || typeof M.Text !== "string") { throw new Error("消息身份或正文损坏, 原内容保留"); } Messages.add(M.Id); }
	}
	if(Value.Outbox !== undefined) { validate_outbox(Value.Outbox); }
	deleted_messages(Value.DeletedMessages);
	if(Value.Sync && (Value.Sync.SchemaVersion !== 1 || typeof Value.Sync.Scope !== "string" || !Number.isSafeInteger(Value.Sync.Revision) || !Array.isArray(Value.Sync.Operations) || !Array.isArray(Value.Sync.Conflicts))) { throw new Error("同步元数据版本无效, 原文件保留"); }
}
export async function load_state_file(Files: StateFiles, Canonical: string, Legacy: string): Promise<any | null>
{
	await recover_save(Files, Canonical);
	const Journal = Canonical + ".migration.json", Staged = Canonical + ".migration.tmp";
	let Existing = await raw_file(Files, Canonical);
	if(await Files.exists(Journal))
	{
		const Receipt = JSON.parse(await Files.read(Journal));
		if(Receipt.SchemaVersion !== 1 || Receipt.Canonical !== Canonical || Receipt.Legacy !== Legacy || Receipt.Staged !== Staged || typeof Receipt.Backup !== "string" || !Receipt.Backup.startsWith(Legacy + ".pre-v2-")) { throw new Error("会话迁移日志无效, 原文件保留"); }
		if(Receipt.Status === "committed") { if(Existing === null) { throw new Error("已提交会话文件缺失, 不用迁移初稿覆盖后续数据"); } const Current = parse_state(Existing); baseline(Files).set(Canonical, Existing); return Current; }
		if(Receipt.Status !== undefined && Receipt.Status !== "pending") { throw new Error("迁移状态版本无效"); }
		const CurrentRaw = await Files.read(Legacy), Raw = await Files.read(Staged), Value = JSON.parse(Raw); validate_saved_state(Value);
		if(await content_digest(CurrentRaw) !== Receipt.SourceDigest || await content_digest(Raw) !== Receipt.TargetDigest || await Files.read(Receipt.Backup) !== CurrentRaw) { throw new Error("迁移期间旧数据或候选发生变化, 保留双方, 不覆盖新内容"); }
		if(Existing !== null && Existing !== Raw)
		{
			try
			{
				const Current = parse_state(Existing);
				if(Receipt.Status === undefined) { await checked_write(Files, Journal, JSON.stringify({ ...Receipt, Status: "committed" })); baseline(Files).set(Canonical, Existing); return Current; }
				throw new Error("迁移期间已存在合法新会话, 保留双方不覆盖");
			}
			catch(ErrorValue) { if(!Raw.startsWith(Existing)) { throw ErrorValue; } }
		}
		if(Existing !== Raw) { await checked_write(Files, Canonical, Raw); }
		const ReadBack = parse_state(await Files.read(Canonical)); if(canonical_json(ReadBack) !== canonical_json(Value)) { throw new Error("迁移读回不一致, 原记录保留"); }
		await checked_write(Files, Journal, JSON.stringify({ ...Receipt, Status: "committed" })); baseline(Files).set(Canonical, Raw); return ReadBack;
	}
	if(Existing !== null) { const Current = parse_state(Existing); baseline(Files).set(Canonical, Existing); return Current; }
	if(!await Files.exists(Legacy)) { baseline(Files).set(Canonical, null); return null; }
	const Raw = await Files.read(Legacy), Saved = JSON.parse(Raw); validate_saved_state(Saved);
	const SourceDigest = await content_digest(Raw), Backup = Legacy + ".pre-v2-" + SourceDigest.slice(0, 16) + ".json";
	if(await Files.exists(Backup)) { if(await Files.read(Backup) !== Raw) { throw new Error("旧数据备份校验冲突, 未覆盖"); } } else { await Files.write(Backup, Raw); }
	if(await Files.read(Backup) !== Raw) { throw new Error("备份读回失败, 未切换会话数据"); }
	const Value = { ...Saved, SchemaVersion: 2 }, Target = JSON.stringify(Value); validate_saved_state(Value);
	await Files.write(Staged, Target); if(canonical_json(JSON.parse(await Files.read(Staged))) !== canonical_json(Value)) { throw new Error("迁移候选读回失败, 原数据保留"); }
	const Receipt = { SchemaVersion: 1, Status: "pending", Canonical, Legacy, Staged, Backup, SourceDigest, TargetDigest: await content_digest(Target) };
	await checked_write(Files, Journal, JSON.stringify(Receipt));
	if(await Files.read(Legacy) !== Raw) { throw new Error("旧会话在迁移期间变化, 不覆盖后续数据"); }
	await checked_write(Files, Canonical, Target); const Result = parse_state(await Files.read(Canonical));
	if(canonical_json(Result) !== canonical_json(Value)) { throw new Error("迁移结果读回不一致, 旧文件保留"); }
	await checked_write(Files, Journal, JSON.stringify({ ...Receipt, Status: "committed" })); baseline(Files).set(Canonical, Target); return Result;
}

export function write_state_file(Files: StateFiles, Canonical: string, Data: unknown): Promise<void>
{
	validate_saved_state(Data);
	let Queue = Queues.get(Files); if(!Queue) { Queue = new Map(); Queues.set(Files, Queue); }
	const Target = JSON.stringify({ ...(Data as any), SchemaVersion: 2 }); parse_state(Target);
	const Work = (Queue.get(Canonical) ?? Promise.resolve()).catch(() => {}).then(async () =>
	{
		await recover_save(Files, Canonical);
		const Current = await raw_file(Files, Canonical), Expected = baseline(Files);
		if(Expected.has(Canonical) && Expected.get(Canonical) !== Current) { throw new Error("当前会话文件已被其他窗口修改, 保留双方, 不覆盖后续消息"); }
		if(Current !== null) { parse_state(Current); }
		if(Current === Target) { Expected.set(Canonical, Current); return; }
		const Staged = Canonical + ".save.stage.json", Journal = Canonical + ".save.journal.json", Backup = Canonical + ".last-committed.json";
		await checked_write(Files, Staged, Target);
		if(Current !== null && await raw_file(Files, Backup) !== Current) { await checked_write(Files, Backup, Current); }
		const Receipt: SaveReceipt = { SchemaVersion: 1, Status: "pending", Canonical, Staged, Backup, PreviousDigest: await content_digest(Current), TargetDigest: await content_digest(Target) };
		await checked_write(Files, Journal, JSON.stringify(Receipt));
		if(await raw_file(Files, Canonical) !== Current) { throw new Error("保存期间当前文件发生并发变化, 保留候选与当前内容"); }
		await checked_write(Files, Canonical, Target);
		await checked_write(Files, Backup, Target); await checked_write(Files, Journal, JSON.stringify({ ...Receipt, Status: "committed" })); Expected.set(Canonical, Target);
	});
	Queue.set(Canonical, Work); return Work;
}
