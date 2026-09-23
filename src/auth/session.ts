import { chromium, type BrowserContext } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { acquireLock, inside, sha256, atomicFile } from '../store/files.js';

/** 每个来源/账号别名一个独立配置目录；不导出 Cookie，不读取用户日常浏览器。 */
export async function openSession(root: string, origin: string, account: string): Promise<{ context: BrowserContext; close: () => Promise<void>; record: (state: string) => Promise<void> }> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(account)) throw new Error('账号别名仅支持字母、数字、下划线和连字符');
  const key = sha256(`${new URL(origin).origin}:${account}`).slice(0,24);
  const release = await acquireLock(root, `session-${key}`);
  try {
    const directory = inside(root, `private/sessions/${key}`); await mkdir(directory, { recursive: true });
    const context = await chromium.launchPersistentContext(inside(directory, 'profile'), { headless: false, acceptDownloads: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    let closed = false;
    return { context, record: async state => atomicFile(inside(directory, 'status.json'), JSON.stringify({ source: new URL(origin).origin, accountAlias: account, state, updatedAt: new Date().toISOString() }, null, 2)),
      close: async () => { if (closed) return; closed = true; try { await context.close(); } finally { await release(); } } };
  } catch (error) { await release(); throw error; }
}

/** 人工点击下载时只接收已出现的下载事件，流式限额；不点击报名或购买按钮。 */
export async function waitForManualDownload(context: BrowserContext, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Buffer; url: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: { bytes: Buffer; url: string }, error?: unknown): void => {
      if (settled) return; settled = true; context.off('page', watch); signal.removeEventListener('abort', abort);
      for (const page of context.pages()) page.off('download', receive);
      if (error) reject(error); else resolve(value!);
    };
    const abort = (): void => finish(undefined, signal.reason ?? new Error('取消'));
    const receive = (download: import('playwright').Download): void => {
      void (async () => {
        const stream = await download.createReadStream(); if (!stream) throw new Error('下载流不可用');
        const chunks: Buffer[] = []; let total = 0;
        for await (const data of stream) {
          if (signal.aborted || (total += data.length) > maxBytes) { await download.cancel(); throw new Error('下载取消或超过限制'); }
          chunks.push(Buffer.from(data));
        }
        if (!total) throw new Error('空文件');
        finish({ bytes: Buffer.concat(chunks), url: download.url() });
      })().catch(error => finish(undefined, error));
    };
    const watch = (page: import('playwright').Page): void => { page.on('download', receive); };
    for (const page of context.pages()) watch(page);
    context.on('page', watch); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
