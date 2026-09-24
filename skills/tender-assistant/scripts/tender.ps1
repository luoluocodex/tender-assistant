param(
    [Parameter(Position = 0)][string]$Action = 'doctor',
    [string]$OutputFile,
    [string]$LogFile,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ForwardArgs
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$logWriter = $null
$resultCode = 1

# Windows argv quoting, including embedded quotes and trailing backslashes.
function Quote-NativeArgument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Write-RunLog([string]$Stage, [string]$Stream, [string]$Text, $Code = $null) {
    if ($script:logWriter) {
        $record = @{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Stage; stream = $Stream; text = $Text }
        if ($null -ne $Code) { $record.exitCode = $Code }
        $script:logWriter.WriteLine(($record | ConvertTo-Json -Compress))
        $script:logWriter.Flush()
    }
}
function Invoke-Node([string[]]$NativeArgs, [string]$Stage) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $script:node
    $info.Arguments = (($NativeArgs | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $script:utf8
    $info.StandardErrorEncoding = $script:utf8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    $started = $false
    try {
        Write-RunLog $Stage 'status' 'started'
        if (-not $process.Start()) { throw 'Node process did not start.' }
        $started = $true
        # Drain both streams concurrently; native stderr warnings are not PowerShell exceptions.
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        # Short waits let PowerShell cancellation reach the finally block.
        while (-not $process.WaitForExit(200)) { }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        Write-RunLog $Stage 'stdout' $stdout
        Write-RunLog $Stage 'stderr' $stderr
        Write-RunLog $Stage 'status' 'finished' $process.ExitCode
        return @{ Stdout = $stdout; Stderr = $stderr; ExitCode = $process.ExitCode }
    } finally {
        # Only terminate the process tree started by this invocation, if interrupted.
        if ($started -and -not $process.HasExited) {
            $cleanupInfo = New-Object System.Diagnostics.ProcessStartInfo
            $cleanupInfo.FileName = Join-Path $env:SystemRoot 'System32/taskkill.exe'
            $cleanupInfo.Arguments = "/PID $($process.Id) /T /F"
            $cleanupInfo.UseShellExecute = $false
            $cleanupInfo.CreateNoWindow = $true
            $cleanupInfo.RedirectStandardOutput = $true
            $cleanupInfo.RedirectStandardError = $true
            $cleanup = [Diagnostics.Process]::Start($cleanupInfo)
            try { if (-not $cleanup.WaitForExit(10000)) { $cleanup.Kill() } }
            finally { $cleanup.Dispose() }
        }
        $process.Dispose()
    }
}
function Publish-ProcessResult($Result, [bool]$IncludeOutput = $true) {
    if ($IncludeOutput -and $Result.Stdout) { Write-Output $Result.Stdout.TrimEnd("`r", "`n") }
    if ($Result.Stderr) { Write-Error -Message $Result.Stderr.TrimEnd("`r", "`n") -ErrorAction Continue }
}
try {
    if ($LogFile) {
        # Reserve before any action, never overwrite an existing diagnostic record.
        $logPath = [IO.Path]::GetFullPath($LogFile)
        $stream = [IO.File]::Open($logPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $logWriter = New-Object IO.StreamWriter($stream, $utf8)
        Write-RunLog 'wrapper' 'status' 'started'
    }
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
    if ($OutputFile -and $Action -notin @('doctor', 'results', 'queue', 'packet')) { throw '-OutputFile is only supported for JSON actions: doctor/results/queue/packet.' }
    if ($OutputFile -and (Test-Path -LiteralPath $OutputFile)) { throw 'Output file already exists; use a unique new path.' }
    $versionResult = Invoke-Node @('--version') 'version'
    $version = $null
    if ($versionResult.ExitCode -ne 0 -or -not [Version]::TryParse(($versionResult.Stdout.Trim() -replace '^v', ''), [ref]$version) -or $version -lt [Version]'24.13.0') { throw 'Node >=24.13.0 required. Reinstall this skill with -NodeExecutable pointing to a supported node.exe.' }
    $compiled = Invoke-Node @($compiler, '-p', (Join-Path $projectRoot 'tsconfig.json')) 'build'
    Publish-ProcessResult $compiled
    if ($compiled.ExitCode -ne 0) { $resultCode = $compiled.ExitCode }
    else {
        $actionArgs = @((Join-Path $projectRoot 'dist/src/assistant/cli.js'), $Action)
        if ($ForwardArgs) { $actionArgs += $ForwardArgs }
        $result = Invoke-Node $actionArgs $Action
        $resultCode = $result.ExitCode
        Publish-ProcessResult $result (-not $OutputFile)
        # doctor exit 2 contains useful failed checks; preserve that JSON without claiming success.
        if ($OutputFile -and ($resultCode -eq 0 -or ($Action -eq 'doctor' -and $resultCode -eq 2))) {
            $outputPath = [IO.Path]::GetFullPath($OutputFile)
            $stream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try { $bytes = $utf8.GetBytes($result.Stdout); $stream.Write($bytes, 0, $bytes.Length) }
            finally { $stream.Dispose() }
        }
    }
} catch {
    Write-RunLog 'wrapper' 'stderr' $_.Exception.Message
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    $resultCode = 1
} finally {
    Write-RunLog 'wrapper' 'status' 'finished' $resultCode
    if ($logWriter) { $logWriter.Dispose() }
}
exit $resultCode
