import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import type { BackendMetadata } from "./backend-result";

export interface HiddenProcessResult
{
	Output: string;
	Submitted: boolean;
	ExitCode: number | null;
	Reason?: string;
	Stopped: boolean;
}
export interface HiddenProcessOptions
{
	Ready?: string;
	GuardTimeoutMs?: number;
	RunTimeoutMs?: number;
	MaxOutputBytes?: number;
	OnMetadata?: (Metadata: BackendMetadata) => void;
}

export function hidden_process(Executable: string, Args: string[], Cwd: string, Env: NodeJS.ProcessEnv, Input: string, Signal: AbortSignal, Options: HiddenProcessOptions = {}): Promise<HiddenProcessResult>
{
	if(Signal.aborted) { return Promise.resolve({ Output: "", Submitted: false, ExitCode: null, Reason: "stopped-before-submit", Stopped: true }); }
	Options.OnMetadata?.({ Submission: "not-submitted", Transport: "buffered" });
	return new Promise(Resolve =>
	{
		const Child = spawn(Executable, Args, { cwd: Cwd, env: Env, windowsHide: true, shell: false, stdio: "pipe" });
		const Decoder = new TextDecoder("utf-8", { fatal: true });
		let Output = "", Bytes = 0, Sent = false, Failure = "", Diagnostic = "", InvalidUtf8 = false, Stopped = false;
		let RunTimer: ReturnType<typeof setTimeout> | undefined, GuardTimer: ReturnType<typeof setTimeout> | undefined;
		const Stop = (Reason: string) =>
		{
			if(Failure) { return; }
			Failure = Reason; Stopped = true; Child.stdin.destroy();
			if(Child.pid && Child.exitCode === null && Child.signalCode === null)
			{
				if(process.platform === "win32")
				{
					execFile(join(process.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe"), ["/PID", String(Child.pid), "/T", "/F"], { windowsHide: true, timeout: 4000 }, ErrorValue =>
					{
						if(ErrorValue && Child.exitCode === null && Child.signalCode === null) { Child.kill(); }
					});
				}
				else { Child.kill("SIGKILL"); }
			}
		};
		const Send = () =>
		{
			if(Sent || Failure) { return; }
			clearTimeout(GuardTimer); Sent = true;
			Options.OnMetadata?.({ Submission: "submitted", Transport: "buffered" });
			RunTimer = setTimeout(() => Stop("agent-timeout-after-submit"), Options.RunTimeoutMs ?? 180000);
			Child.stdin.end(Input, "utf8");
		};
		const Abort = () => Stop(Sent ? "stopped-waiting-after-submit" : "stopped-before-submit");
		Signal.addEventListener("abort", Abort, { once: true });
		Child.stdout.on("data", (Chunk: Buffer) =>
		{
			if(Failure) { return; }
			Bytes += Chunk.length;
			if(Bytes > (Options.MaxOutputBytes ?? 2 * 1024 * 1024)) { Stop("agent-output-limit-after-submit"); return; }
			try { Output += Decoder.decode(Chunk, { stream: true }); }
			catch { InvalidUtf8 = true; Stop("agent-invalid-utf8-after-submit"); }
		});
		Child.stderr.on("data", (Chunk: Buffer) =>
		{
			if(!Options.Ready || Sent || Failure) { return; }
			Diagnostic = (Diagnostic + Chunk.toString("utf8")).slice(-4096);
			if(Diagnostic.replaceAll("\r\n", "\n").includes("\n" + Options.Ready + "\n")) { Send(); }
		});
		Child.stdin.on("error", () => { /* Delivery may already have reached the owned process. */ });
		Child.on("error", () => { Failure ||= "agent-launch-failed-before-submit"; });
		Child.on("spawn", () =>
		{
			if(Signal.aborted) { Abort(); }
			else if(Options.Ready) { GuardTimer = setTimeout(() => Stop("guard-not-ready-before-submit"), Options.GuardTimeoutMs ?? 25000); }
			else { Send(); }
		});
		Child.on("close", Code =>
		{
			clearTimeout(GuardTimer); clearTimeout(RunTimer); Signal.removeEventListener("abort", Abort);
			if(!InvalidUtf8) { try { Output += Decoder.decode(); } catch { Failure ||= "agent-invalid-utf8-after-submit"; } }
			Resolve({ Output, Submitted: Sent, ExitCode: Code, Stopped, ...(Failure || Code !== 0 || !Sent ? { Reason: Failure || (Sent ? `agent-exit-after-submit:${Code ?? "signal"}` : "guard-not-ready-before-submit") } : {}) });
		});
	});
}
