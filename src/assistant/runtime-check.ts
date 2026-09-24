import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { currentWindowsSid, protectWindowsDirectory } from '../store/windows-access.js';

type Check = { status: 'passed' | 'failed' | 'not-checked' | 'not-applicable'; message?: string };

async function check(operation: () => Promise<void>): Promise<Check> {
  try { await operation(); return { status: 'passed' }; }
  catch (error) { return { status: 'failed', message: error instanceof Error ? error.message.split('\n')[0] ?? 'UNKNOWN_ERROR' : 'UNKNOWN_ERROR' }; }
}

/** 在当前宿主核验异步子进程；扩展检查只操作独立空目录和有头空白页，不访问站点。 */
export async function runtimeCheck(project: string, extended: boolean) {
  const subprocess = await check(async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("tender-child-ok")'], { timeout: 15000, windowsHide: true });
    if (stdout !== 'tender-child-ok') throw new Error('SUBPROCESS_OUTPUT_INVALID');
  });
  const windowsIdentity: Check = process.platform === 'win32'
    ? await check(async () => { await currentWindowsSid(); }) : { status: 'not-applicable' };
  let directoryPermissions: Check = { status: 'not-checked' };
  let browser: Check = { status: 'not-checked' };
  if (extended) {
    directoryPermissions = process.platform === 'win32' ? await check(async () => {
      const parent = join(project, 'output/playwright/tests'); await mkdir(parent, { recursive: true });
      const probe = await mkdtemp(join(parent, 'doctor-acl-'));
      try { await protectWindowsDirectory(probe); }
      finally { await rmdir(probe); }
    }) : { status: 'not-applicable' };
    browser = await check(async () => {
      const instance = await chromium.launch({ headless: false, timeout: 15000 });
      try {
        const page = await instance.newPage();
        await page.goto('about:blank');
        await page.setContent('<title>Tender Assistant runtime check</title>');
        if (await page.title() !== 'Tender Assistant runtime check') throw new Error('BROWSER_PAGE_CHECK_FAILED');
      } finally { await instance.close(); }
    });
  }
  return { subprocess, windowsIdentity, directoryPermissions, browser };
}
