param(
    [Parameter(Position = 0)][string]$Action = 'doctor',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ForwardArgs
)
$ErrorActionPreference = 'Stop'
try {
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
    $node = @(Get-Command node -CommandType Application -ErrorAction Stop)[0].Source
    & $node $compiler '-p' (Join-Path $projectRoot 'tsconfig.json')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $node (Join-Path $projectRoot 'dist/src/assistant/cli.js') $Action @ForwardArgs
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
