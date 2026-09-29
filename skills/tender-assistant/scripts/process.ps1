# 子进程输出属于结果通道；普通日志仅记录固定状态、长度和允许的事件。
function Quote-NativeArgument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Write-RunLog([string]$Stage, [string]$Stream, [string]$Text, $Code = $null, $Count = $null) {
    if ($script:logWriter) {
        $record = @{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Stage; stream = $Stream; text = $Text }
        if ($null -ne $Code) { $record.exitCode = $Code }
        if ($null -ne $Count) { $record.charCount = $Count }
        $script:logWriter.WriteLine(($record | ConvertTo-Json -Compress))
        $script:logWriter.Flush()
    }
}
# 创建文件时原子应用 ACL；失败时不保存材料，不修改父目录权限。
function New-ProtectedWriter([string]$Path) {
    $stream = $null
    try {
        $acl = New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
        foreach ($identity in @($sid, $system)) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')))
        }
        $fullPath = [IO.Path]::GetFullPath($Path)
        if ($PSVersionTable.PSEdition -eq 'Desktop') {
            $stream = [IO.FileStream]::new($fullPath, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::None, $acl)
        } else {
            $stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($fullPath), [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::None, $acl)
        }
        return New-Object IO.StreamWriter($stream, $script:utf8)
    } catch { if ($stream) { $stream.Dispose() }; throw }
}
function Write-HandoffEvent([string]$Stage, [string]$Line) {
    if ($Stage -ne 'archive') { return }
    try { $event = $Line | ConvertFrom-Json -ErrorAction Stop } catch { return }
    if ($event.event -eq 'human-handoff') {
        # 不复制网站、附件名称或事件原文。宿主从固定事件得知需要人工接管。
        Write-RunLog $Stage 'status' 'needs-human'
    }
}
function Invoke-Node([string[]]$NativeArgs, [string]$Stage, [bool]$Publish = $false, [bool]$Interactive = $false) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $script:node
    $info.Arguments = (($NativeArgs | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    # 人工登录沿用调用终端的 stdin/控制台，不能使用无控制台的进程。
    $info.CreateNoWindow = -not $Interactive
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
        $streams = @(
            @{ Name = 'stdout'; Reader = $process.StandardOutput; Writer = [Console]::Out },
            @{ Name = 'stderr'; Reader = $process.StandardError; Writer = [Console]::Error }
        )
        foreach ($s in $streams) {
            $s.Buffer = New-Object char[] 4096
            $s.Text = New-Object Text.StringBuilder
            $s.Pending = $s.Reader.ReadAsync($s.Buffer, 0, $s.Buffer.Length)
        }
        $lineBuffer = ''
        # 按字符块并发排空双流；无换行的 readline 提示也必须实时可见。
        while (@($streams | Where-Object { $null -ne $_.Pending }).Count -gt 0 -or -not $process.HasExited) {
            foreach ($s in $streams) {
                if (-not $s.Pending -or -not $s.Pending.IsCompleted) { continue }
                $count = $s.Pending.GetAwaiter().GetResult()
                if ($count -eq 0) { $s.Pending = $null; continue }
                $chunk = [string]::new($s.Buffer, 0, $count)
                [void]$s.Text.Append($chunk)
                if ($Publish -and ($s.Name -eq 'stderr' -or -not $script:OutputFile -or $Interactive)) {
                    $s.Writer.Write($chunk); $s.Writer.Flush()
                }
                if ($s.Name -eq 'stderr' -and $script:errorWriter) {
                    $script:errorWriter.Write($chunk); $script:errorWriter.Flush()
                }
                if ($s.Name -eq 'stdout' -and $Stage -eq 'archive') {
                    $lineBuffer += $chunk
                    while (($newline = $lineBuffer.IndexOf("`n")) -ge 0) {
                        Write-HandoffEvent $Stage $lineBuffer.Substring(0, $newline)
                        $lineBuffer = $lineBuffer.Substring($newline + 1)
                    }
                }
                $s.Pending = $s.Reader.ReadAsync($s.Buffer, 0, $s.Buffer.Length)
            }
            Start-Sleep -Milliseconds 20
        }
        $process.WaitForExit()
        foreach ($s in $streams) { Write-RunLog $Stage $s.Name 'captured' $null $s.Text.Length }
        Write-RunLog $Stage 'status' 'finished' $process.ExitCode
        return @{ Stdout = $streams[0].Text.ToString(); Stderr = $streams[1].Text.ToString(); ExitCode = $process.ExitCode }
    } finally {
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
