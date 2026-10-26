export interface DiagnosticItem { Name: string; Status: "ok" | "warning" | "error" | "unavailable"; Detail: string; Action?: string; }
export interface DiagnosticProbe { Name: string; Run(): Promise<Omit<DiagnosticItem, "Name">>; }
export async function environment_diagnostics(Probes: DiagnosticProbe[]): Promise<DiagnosticItem[]>
{
	return Promise.all(Probes.map(async Probe =>
	{
		try { return { Name: Probe.Name, ...await Probe.Run() }; }
		catch(ErrorValue) { return { Name: Probe.Name, Status: "error" as const, Detail: ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue), Action: "修复此项后重新检查; 不会自动下载、改配置或重启服务" }; }
	}));
}
