param(
	[string]$Config = (Join-Path $env:LOCALAPPDATA 'CodexObsidianRemote\config.json'),
	[string]$Bridge = (Join-Path $PSScriptRoot '..\bridge.cjs')
)
$ErrorActionPreference = 'Stop'
$ConfigPath = (Resolve-Path -LiteralPath $Config).Path
$BridgePath = (Resolve-Path -LiteralPath $Bridge).Path
$PidFile = Join-Path (Split-Path -Parent $ConfigPath) 'service.pid'
if(!(Test-Path -LiteralPath $PidFile))
{
	Write-Output 'No recorded bridge process.'
	return
}
$ServiceId = [int](Get-Content -LiteralPath $PidFile -Raw)
$Process = Get-CimInstance Win32_Process -Filter "ProcessId=$ServiceId"
if(!$Process)
{
	Remove-Item -LiteralPath $PidFile
	Write-Output 'Bridge is already stopped.'
	return
}
if($Process.ExecutablePath -ne (Get-Command node.exe).Source -or !$Process.CommandLine.Contains($BridgePath) -or !$Process.CommandLine.Contains($ConfigPath))
{
	throw 'Recorded PID belongs to another process. Refusing to stop it.'
}
# Stop only descendants of the verified bridge process.
$Processes = @(Get-CimInstance Win32_Process)
$Owned = [System.Collections.Generic.List[object]]::new()
$Queue = [System.Collections.Generic.Queue[uint32]]::new()
$Queue.Enqueue([uint32]$ServiceId)
while($Queue.Count -gt 0)
{
	$Parent = $Queue.Dequeue()
	foreach($Child in $Processes)
	{
		if($Child.ParentProcessId -eq $Parent)
		{
			$Owned.Add($Child)
			$Queue.Enqueue([uint32]$Child.ProcessId)
		}
	}
}
for($Index = $Owned.Count - 1; $Index -ge 0; $Index--)
{
	$Child = $Owned[$Index]
	$Current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Child.ProcessId)"
	if($Current -and $Current.CreationDate -eq $Child.CreationDate)
	{
		Stop-Process -Id $Child.ProcessId -ErrorAction SilentlyContinue
	}
}
$Current = Get-CimInstance Win32_Process -Filter "ProcessId=$ServiceId"
if($Current -and $Current.CreationDate -eq $Process.CreationDate)
{
	Stop-Process -Id $ServiceId
}
Remove-Item -LiteralPath $PidFile
Write-Output 'Independent bridge stopped. Remote tasks were interrupted.'
