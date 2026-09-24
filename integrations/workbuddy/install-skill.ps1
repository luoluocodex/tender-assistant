param([string]$Destination, [string]$NodeExecutable, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path $env:USERPROFILE '.workbuddy/skills/tender-assistant' }
& (Join-Path $PSScriptRoot '../install-skill.ps1') -Destination $Destination -TargetHost workbuddy -NodeExecutable $NodeExecutable -Uninstall:$Uninstall
exit $LASTEXITCODE
