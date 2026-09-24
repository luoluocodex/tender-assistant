param(
    [Parameter(Position = 0)][string]$Action = 'doctor',
    [string]$OutputFile,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ForwardArgs
)
$ErrorActionPreference = 'Stop'
$previousEncoding = [Console]::OutputEncoding
try {
    $binding = $null
    # PowerShell 5.1 must decode native Node stdout as UTF-8 before capturing it.
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $skillRoot = Split-Path -Parent $PSScriptRoot
    $bindingPath = Join-Path $skillRoot 'project.json'
    if (Test-Path -LiteralPath $bindingPath) {
        $binding = Get-Content -LiteralPath $bindingPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($binding.schemaVersion -ne 1) { throw 'Invalid skill project binding.' }
        $projectRoot = [IO.Path]::GetFullPath($binding.projectRoot)
    } else {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $skillRoot)
    }
    $manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -ne 'tender-assistant') { throw 'Project binding does not point to tender-assistant.' }
    $compiler = Join-Path $projectRoot 'node_modules/typescript/bin/tsc'
    if (-not (Test-Path -LiteralPath $compiler)) { throw 'Dependencies missing. Run pnpm install --frozen-lockfile --ignore-scripts in the project.' }
    $node = if ($binding -and $binding.nodeExecutable) { $binding.nodeExecutable } else { @(Get-Command node -CommandType Application -ErrorAction Stop)[0].Source }
    $versionText = & $node --version
    $version = $null
    if ($LASTEXITCODE -ne 0 -or -not [Version]::TryParse(($versionText -replace '^v', ''), [ref]$version) -or $version -lt [Version]'24.13.0') { throw 'Node >=24.13.0 required. Reinstall this skill with -NodeExecutable pointing to a supported node.exe.' }
    if ($OutputFile -and $Action -notin @('doctor', 'results', 'queue', 'packet')) { throw '-OutputFile is only supported for read-only JSON actions: doctor/results/queue/packet.' }
    & $node $compiler '-p' (Join-Path $projectRoot 'tsconfig.json')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($OutputFile) {
        $lines = & $node (Join-Path $projectRoot 'dist/src/assistant/cli.js') $Action @ForwardArgs
        $resultCode = $LASTEXITCODE
        if ($resultCode -ne 0) { exit $resultCode }
        $outputPath = [IO.Path]::GetFullPath($OutputFile)
        # CreateNew avoids overwriting a user file or mistaking stale output for this run.
        $stream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try {
            $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($lines -join "`n") + "`n")
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
        exit $resultCode
    } else {
        & $node (Join-Path $projectRoot 'dist/src/assistant/cli.js') $Action @ForwardArgs
        exit $LASTEXITCODE
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    [Console]::OutputEncoding = $previousEncoding
}
