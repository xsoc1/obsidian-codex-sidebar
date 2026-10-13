param(
	[string]$Config = (Join-Path $env:LOCALAPPDATA 'CodexObsidianRemote\config.json'),
	[string]$Bridge = (Join-Path $PSScriptRoot '..\bridge.cjs')
)
$ErrorActionPreference = 'Stop'
$ConfigPath = (Resolve-Path -LiteralPath $Config).Path
$BridgePath = (Resolve-Path -LiteralPath $Bridge).Path
$NodePath = (Get-Command node.exe).Source
$PrivateDir = Split-Path -Parent $ConfigPath
$PidFile = Join-Path $PrivateDir 'service.pid'
if(Test-Path -LiteralPath $PidFile)
{
	$ServiceId = [int](Get-Content -LiteralPath $PidFile -Raw)
	$Process = Get-CimInstance Win32_Process -Filter "ProcessId=$ServiceId"
	if($Process)
	{
		if($Process.ExecutablePath -eq $NodePath -and $Process.CommandLine.Contains($BridgePath) -and $Process.CommandLine.Contains($ConfigPath))
		{
			Write-Output "Independent bridge already running. PID=$ServiceId"
			return
		}
		throw 'Recorded PID belongs to another process. Inspect service.pid before starting.'
	}
}
$Started = Start-Process -FilePath $NodePath -ArgumentList @('"' + $BridgePath + '"', '--config', '"' + $ConfigPath + '"') -WorkingDirectory (Split-Path -Parent $BridgePath) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PrivateDir 'service.log') -RedirectStandardError (Join-Path $PrivateDir 'service-error.log')
Start-Sleep -Milliseconds 700
$Started.Refresh()
if($Started.HasExited)
{
	throw 'Bridge exited. Read service-error.log in the private config directory.'
}
Set-Content -LiteralPath $PidFile -Value $Started.Id -Encoding ascii
Write-Output "Independent bridge started. PID=$($Started.Id)"
