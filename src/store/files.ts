import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, open, unlink, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

/** 所有内部相对路径必须留在数据根目录。 */
export function inside(root: string, path: string): string {
  const full = resolve(root, path); const rel = relative(resolve(root), full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('归档路径越界');
  return full;
}

/** 新建运行目录；业务材料与会话限制为当前 Windows 用户和 SYSTEM。 */
export async function initializeRoot(root: string, protect = true): Promise<void> {
  await mkdir(root, { recursive: true });
  if (protect && process.platform === 'win32') {
    const output = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = output.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
    if (!sid) throw new Error('无法确认数据目录权限主体');
    execFileSync('icacls', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
  }
  for (const name of ['objects', 'parsed', 'notices', 'runs', 'private/sessions', 'backups']) await mkdir(inside(root, name), { recursive: true });
}

/** 原子发布结果；临时文件始终和目标在同一个目录。 */
export async function atomicFile(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.partial`;
  try { await writeFile(temp, contents, { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}

/** 单进程锁；只清理确认原持有进程已退出的本项目锁。 */
export async function acquireLock(root: string, name = 'archive'): Promise<() => Promise<void>> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('锁名无效');
  const path = inside(root, `${name}.lock`); const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx');
      await file.writeFile(JSON.stringify({ pid: process.pid, token })); await file.close();
      return async () => { const current: unknown = JSON.parse(await readFile(path, 'utf8')); if (current && typeof current === 'object' && 'token' in current && current.token === token) await unlink(path); };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      const state: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!state || typeof state !== 'object' || !('pid' in state) || !Number.isInteger(state.pid) || Number(state.pid) <= 0) throw new Error('锁文件异常，需人工检查');
      try { process.kill(Number(state.pid), 0); throw new Error('另一个归档或会话进程仍在运行'); }
      catch (probe) {
        if (!probe || typeof probe !== 'object' || !('code' in probe) || probe.code !== 'ESRCH') throw probe;
        await unlink(path);
      }
    }
  }
  throw new Error('无法取得运行锁');
}
