param([string]$Destination, [string]$NodeExecutable, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if (-not $Destination) {
    $skillHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $Destination = Join-Path $skillHome 'skills/tender-assistant'
}
& (Join-Path $PSScriptRoot '../install-skill.ps1') -Destination $Destination -TargetHost codex -NodeExecutable $NodeExecutable -Uninstall:$Uninstall
exit $LASTEXITCODE
