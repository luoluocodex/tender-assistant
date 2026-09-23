param([string]$Destination, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$sourceRoot = Join-Path $projectRoot 'skills/tender-assistant'
if (-not $Destination) {
    $skillHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $Destination = Join-Path $skillHome 'skills/tender-assistant'
}
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
$utf8 = New-Object System.Text.UTF8Encoding($false)
function File-Hash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Resolve-OwnedPath([string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative)) { throw 'Absolute paths are not allowed in the ownership manifest.' }
    $path = [IO.Path]::GetFullPath((Join-Path $destinationRoot $Relative))
    if (-not $path.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes the skill destination.' }
    return $path
}
try {
    if ((Split-Path -Leaf $destinationRoot) -ne 'tender-assistant' -or $destinationRoot -eq $projectRoot -or $projectRoot.StartsWith($destinationRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $destinationRoot.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be a separate directory named tender-assistant.' }
    # Reject linked ancestors before writes or removals.
    $ancestor = $destinationRoot
    while ($ancestor) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked destination paths are not supported.' }
        $ancestor = Split-Path -Parent $ancestor
    }
    $manifestPath = Join-Path $destinationRoot '.install-manifest.json'
    $oldFiles = @()
    if (Test-Path -LiteralPath $destinationRoot) {
        if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Existing unowned skill: refusing to overwrite.' }
        $old = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($old.schemaVersion -ne 1 -or $old.projectRoot -ne $projectRoot) { throw 'Skill belongs to another project or installer.' }
        $oldFiles = @($old.files)
        foreach ($file in $oldFiles) {
            $owned = Resolve-OwnedPath $file.path
            if (-not (Test-Path -LiteralPath $owned -PathType Leaf) -or (File-Hash $owned) -ne $file.sha256) { throw 'Installed skill has local changes; preserve and review them before updating.' }
        }
        $known = @($oldFiles | ForEach-Object { Resolve-OwnedPath $_.path }) + @($manifestPath)
        foreach ($item in Get-ChildItem -LiteralPath $destinationRoot -Recurse -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked files are not supported.' }
            if (-not $item.PSIsContainer -and $known -notcontains $item.FullName) { throw 'Unmanaged file found; refusing to overwrite or remove.' }
        }
    } elseif ($Uninstall) { throw 'Skill is not installed at this destination.' }

    if ($Uninstall) {
        foreach ($file in $oldFiles) { Remove-Item -LiteralPath (Resolve-OwnedPath $file.path) }
        Remove-Item -LiteralPath $manifestPath
        Get-ChildItem -LiteralPath $destinationRoot -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
            if (@(Get-ChildItem -LiteralPath $_.FullName -Force).Count -eq 0) { Remove-Item -LiteralPath $_.FullName }
        }
        if (@(Get-ChildItem -LiteralPath $destinationRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $destinationRoot }
        @{ status = 'uninstalled'; destination = $destinationRoot; runtimeDataDeleted = $false } | ConvertTo-Json
        exit 0
    }

    $files = @()
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
        $relative = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        if ($relative -in @('project.json', '.install-manifest.json')) { throw 'Generated install files must not be placed in the source skill.' }
        $files += @{ path = $relative; bytes = [IO.File]::ReadAllBytes($file.FullName) }
    }
    $binding = @{ schemaVersion = 1; projectRoot = $projectRoot } | ConvertTo-Json
    $files += @{ path = 'project.json'; bytes = $utf8.GetBytes($binding + "`n") }
    $newPaths = @($files | ForEach-Object { $_.path })
    foreach ($file in $oldFiles) { if ($newPaths -notcontains $file.path) { Remove-Item -LiteralPath (Resolve-OwnedPath $file.path) } }
    $installed = @()
    foreach ($file in $files) {
        $target = Resolve-OwnedPath $file.path
        [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
        [IO.File]::WriteAllBytes($target, $file.bytes)
        $installed += @{ path = $file.path; sha256 = File-Hash $target }
    }
    $record = @{ schemaVersion = 1; projectRoot = $projectRoot; files = $installed } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($manifestPath, $record + "`n", $utf8)
    @{ status = 'installed'; destination = $destinationRoot; projectRoot = $projectRoot; files = $installed.Count } | ConvertTo-Json
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
