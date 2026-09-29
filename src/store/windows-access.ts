import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** 使用异步子进程调用权限工具；失败即停止，不跳过 ACL 或回退到放宽权限。 */
async function permissionCommand(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execute(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536 });
    return stdout;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    // 不把原始命令、账户 SID 或工具输出写入普通错误日志。
    throw new Error(`WINDOWS_ACL_FAILED: ${command} (${code})；数据目录权限检查未通过，已停止。请在同一宿主运行 doctor --runtime-check 查看具体阶段。`);
  }
}

/** 只读取当前 Windows 进程的用户 SID，不修改文件权限。 */
export async function currentWindowsSid(): Promise<string> {
  const output = await permissionCommand('whoami', ['/user', '/fo', 'csv', '/nh']);
  const sid = output.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
  if (!sid) throw new Error('WINDOWS_SID_INVALID: 无法确认数据目录权限主体');
  return sid;
}

/** 保持现有权限策略：去除继承，授予当前用户与 SYSTEM 完全控制；失败不继续归档。 */
export async function protectWindowsDirectory(root: string): Promise<void> {
  const sid = await currentWindowsSid();
  await permissionCommand('icacls', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
}
