param([string]$OutputDirectory = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Push-Location -LiteralPath $ProjectRoot
try
{
	$Changes = @(& git status --porcelain --untracked-files=normal)
	if($LASTEXITCODE -ne 0 -or $Changes.Count -gt 0) { throw "Commit and review the candidate sources before packaging." }
	$Commit = (& git rev-parse HEAD).Trim()
	$Manifest = Get-Content -LiteralPath "manifest.json" -Raw | ConvertFrom-Json
	$Package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
	if($Manifest.version -ne $Package.version) { throw "Product versions differ." }
	& npm run build
	if($LASTEXITCODE -ne 0) { throw "Build failed." }
	if(!$OutputDirectory) { $OutputDirectory = Join-Path $ProjectRoot ("dist/candidates/" + $Manifest.version + "-" + $Commit.Substring(0, 8)) }
	$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
	New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
	$Sets = @(
		@{ Name = "codex-sidebar-$($Manifest.version).zip"; Members = @("manifest.json", "main.js", "main.js.map", "styles.css") },
		@{ Name = "codex-sidebar-windows-bridge-$($Manifest.version).zip"; Members = @("bridge.cjs", "manifest.json", "scripts/start-bridge.ps1", "scripts/stop-bridge.ps1", "docs/ipad-setup.md", "docs/pdf-support.md", "docs/migration.md", "docs/sync-protocol.md", "docs/development.md", "docs/reliability-suite.md", "docs/history/ipad-setup-through-1.1.0.md", "docs/history/pdf-support-through-1.1.0.md", "examples/pdf/text-mini.pdf", "examples/pdf/scanned-mini.pdf", "examples/pdf/dense-formula-mini.pdf", "README.md") }
	)
	$Artifacts = @()
	foreach($Set in $Sets)
	{
		$ArchivePath = Join-Path $OutputDirectory $Set.Name
		if(Test-Path -LiteralPath $ArchivePath) { throw "Candidate archive already exists; preserve it or select a new output directory." }
		$Archive = [IO.Compression.ZipFile]::Open($ArchivePath, [IO.Compression.ZipArchiveMode]::Create)
		$Members = @()
		try
		{
			foreach($Name in $Set.Members)
			{
				$SourceName = if($Name -eq "README.md" -and $Set.Name -like "*windows-bridge*") { "docs/bridge-package.md" } else { $Name }
				$Source = Join-Path $ProjectRoot $SourceName
				[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $Source, $Name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
				$Members += @{ Name = $Name; Bytes = (Get-Item -LiteralPath $Source).Length; SHA256 = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant() }
			}
		}
		finally { $Archive.Dispose() }
		$ReadBack = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
		try
		{
			if($ReadBack.Entries.Count -ne $Members.Count) { throw "Archive membership differs." }
			foreach($Member in $Members)
			{
				$Entry = $ReadBack.GetEntry($Member.Name)
				if(!$Entry -or $Entry.Length -ne $Member.Bytes) { throw "Archive member size differs." }
				$Stream = $Entry.Open(); $Hasher = [Security.Cryptography.SHA256]::Create()
				try { $Digest = ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace("-", "").ToLowerInvariant() }
				finally { $Stream.Dispose(); $Hasher.Dispose() }
				if($Digest -ne $Member.SHA256) { throw "Archive member digest differs." }
			}
		}
		finally { $ReadBack.Dispose() }
		$Artifacts += @{ Name = $Set.Name; SHA256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant(); Members = $Members }
	}
	$Receipt = @{ SchemaVersion = 1; ProductVersion = $Manifest.version; SyncProtocol = 2; SourceCommit = $Commit; Node = (& node --version); CreatedAtUTC = [DateTime]::UtcNow.ToString("o"); Artifacts = $Artifacts }
	[IO.File]::WriteAllText((Join-Path $OutputDirectory "candidate-manifest.json"), ($Receipt | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
	Write-Output $OutputDirectory
}
finally { Pop-Location }
