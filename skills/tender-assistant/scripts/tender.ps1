param(
    [Parameter(Position = 0)][string]$Action = 'doctor',
    [string]$OutputFile,
    [string]$ErrorFile,
    [string]$LogFile,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ForwardArgs
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$logWriter = $null
$outputWriter = $null
$errorWriter = $null
$resultCode = 1
$outputSaved = $false
. (Join-Path $PSScriptRoot 'process.ps1')
try {
    if ($LogFile) {
        $stream = [IO.File]::Open([IO.Path]::GetFullPath($LogFile), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $logWriter = New-Object IO.StreamWriter($stream, $utf8)
        Write-RunLog 'wrapper' 'status' 'started'
    }
    # 所有输出路径先独占预留；ACL 失败、路径重复或已有文件均在业务动作前拒绝。
    if ($ErrorFile) { $errorWriter = New-ProtectedWriter $ErrorFile }
    if ($OutputFile) { $outputWriter = New-ProtectedWriter $OutputFile }
    $binding = $null
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
    $actions = @('doctor', 'results', 'queue', 'packet', 'collect', 'archive', 'analyze', 'notify', 'help', '--help')
    if ($Action -notin $actions) { throw 'Unknown action; use help.' }
    $versionResult = Invoke-Node @('--version') 'version'
    $version = $null
    if ($versionResult.ExitCode -ne 0 -or -not [Version]::TryParse(($versionResult.Stdout.Trim() -replace '^v', ''), [ref]$version) -or $version -lt [Version]'24.13.0') { throw 'Node >=24.13.0 required. Reinstall this skill with -NodeExecutable pointing to a supported node.exe.' }
    $compiled = Invoke-Node @($compiler, '-p', (Join-Path $projectRoot 'tsconfig.json')) 'build' $true
    if ($compiled.ExitCode -ne 0) {
        $resultCode = $compiled.ExitCode
        if ($errorWriter) { $errorWriter.Write($compiled.Stdout) }
    } else {
        $actionArgs = @((Join-Path $projectRoot 'dist/src/assistant/cli.js'), $Action)
        if ($ForwardArgs) { $actionArgs += $ForwardArgs }
        $interactive = $Action -eq 'archive' -and @($ForwardArgs | Where-Object { $_ -match '^--(?:auth(?:=|$)|manual-download$)' }).Count -gt 0
        $result = Invoke-Node $actionArgs $Action $true $interactive
        $resultCode = $result.ExitCode
        # JSON 只读动作沿用成功输出约定；阶段动作保留部分完成/失败时的 stdout。
        $jsonAction = $Action -in @('doctor', 'results', 'queue', 'packet')
        if ($outputWriter -and (-not $jsonAction -or $resultCode -eq 0 -or ($Action -eq 'doctor' -and $resultCode -eq 2))) {
            $outputWriter.Write($result.Stdout)
            $outputSaved = $true
        }
    }
} catch {
    # 异常消息可能包含路径、URL 或输入数据，只放在受保护错误文件和终端。
    Write-RunLog 'wrapper' 'status' 'failed-see-error-file'
    if ($errorWriter) { $errorWriter.WriteLine($_.Exception.Message) }
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    $resultCode = 1
} finally {
    if ($outputWriter) {
        $outputWriter.Dispose()
        if (-not $outputSaved) { Remove-Item -LiteralPath ([IO.Path]::GetFullPath($OutputFile)) }
    }
    if ($errorWriter) { $errorWriter.Dispose() }
    Write-RunLog 'wrapper' 'status' 'finished' $resultCode
    if ($logWriter) { $logWriter.Dispose() }
}
exit $resultCode
