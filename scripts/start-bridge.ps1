param(
	[string]$Config = (Join-Path $env:LOCALAPPDATA 'CodexObsidianRemote\config.json'),
	[string]$Bridge = (Join-Path $PSScriptRoot '..\bridge.cjs'),
	[switch]$PromptApiKey
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
			if($PromptApiKey)
			{
				throw 'Independent bridge is already running. Stop it before changing authentication.'
			}
			Write-Output "Independent bridge already running. PID=$ServiceId"
			return
		}
		throw 'Recorded PID belongs to another process. Inspect service.pid before starting.'
	}
}
$PreviousKey = $env:CODEX_SIDEBAR_API_KEY
try
{
	if($PromptApiKey)
	{
		$SecureKey = Read-Host 'OpenAI API Key for this bridge' -AsSecureString
		$KeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
		try
		{
			$env:CODEX_SIDEBAR_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($KeyPointer).Trim()
			if($env:CODEX_SIDEBAR_API_KEY -cnotmatch '^sk-[a-zA-Z0-9_-]{16,509}$')
			{
				throw 'Invalid OpenAI API Key format.'
			}
		}
		finally
		{
			[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($KeyPointer)
			$SecureKey.Dispose()
		}
	}
	$Started = Start-Process -FilePath $NodePath -ArgumentList @('"' + $BridgePath + '"', '--config', '"' + $ConfigPath + '"') -WorkingDirectory (Split-Path -Parent $BridgePath) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PrivateDir 'service.log') -RedirectStandardError (Join-Path $PrivateDir 'service-error.log')
}
finally
{
	$env:CODEX_SIDEBAR_API_KEY = $PreviousKey
}
Start-Sleep -Milliseconds 700
$Started.Refresh()
if($Started.HasExited)
{
	throw 'Bridge exited. Read service-error.log in the private config directory.'
}
Set-Content -LiteralPath $PidFile -Value $Started.Id -Encoding ascii
Write-Output "Independent bridge started. PID=$($Started.Id)"
