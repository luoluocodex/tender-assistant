import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext } from 'playwright';
import type { ArchiveConfig, ArchiveItem } from './model.js';
import { ArchiveError } from './model.js';
import { downloadFile } from './download.js';
import { parseIsolated } from './parse.js';
import { ArchiveStore } from '../store/archive-store.js';
import { displayUrl } from './source.js';

/** 下载队列只在文件及解析结果落盘后推进；中断后依据 SQLite 继续。 */
export async function runArchive(store: ArchiveStore, jobId: string, config: ArchiveConfig, signal: AbortSignal, options: { refresh?: boolean; session?: BrowserContext; sessionOrigin?: string } = {}): Promise<{ status: string; jobId: string; report: string }> {
  await store.setStatus(jobId, 'running'); const stopped = new Set<string>(); let lastAction = 0;
  for (const item of store.items(jobId)) {
    if (signal.aborted) break;
    const origin = new URL(item.candidate.url).origin;
    if (stopped.has(origin)) continue;
    try {
      const existing = options.refresh ? null : await store.reusable(item.candidate.attachmentId);
      if (existing) { store.applyFile(item, existing, true); store.update(item); await store.report(jobId); await store.event(jobId, 'attachment-reused', { itemId: item.id, sha256: existing.sha256, status: item.status }); continue; }
      item.status = 'downloading'; item.reason = ''; store.update(item); await store.report(jobId);
      await delay(Math.max(0, config.minIntervalMs - (Date.now() - lastAction)), undefined, { signal }); lastAction = Date.now();
      const session = options.sessionOrigin === origin ? options.session : undefined;
      const result = await downloadFile(item.candidate.url, item.candidate.noticeUrl, config, AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]), session);
      const parsed = await parseIsolated(result.bytes, config, signal);
      await store.save(item, result.bytes, parsed, result.finalUrl, session ? 'session-cookie-http' : 'public-http');
    } catch (error) {
      item.status = signal.aborted ? 'cancelled' : error instanceof ArchiveError ? error.action : 'failed';
      item.reason = signal.aborted ? 'CANCELLED' : error instanceof ArchiveError ? error.code : 'NETWORK_OR_STORAGE_ERROR';
      store.update(item);
      if (item.status === 'needs-human' || item.status === 'limited') stopped.add(origin);
    }
    await store.report(jobId);
    await store.event(jobId, 'attachment-finished', { itemId: item.id, status: item.status, parseStatus: item.parseStatus, reason: item.reason });
    console.log(JSON.stringify({ event: 'attachment-finished', jobId, itemId: item.id, name: item.candidate.name, source: displayUrl(item.candidate.url), status: item.status, parseStatus: item.parseStatus, reason: item.reason }));
  }
  const items = store.items(jobId);
  const status = signal.aborted ? 'cancelled' : items.every(i => i.status === 'complete') ? 'complete' : items.some(i => i.status === 'needs-human') ? 'needs-human' : 'partial';
  await store.setStatus(jobId, status);
  return { status, jobId, report: await store.report(jobId) };
}

/** 人工取得的文件仍进行类型、大小、解析和版本校验，保留 manual-import 来源。 */
export async function importFile(store: ArchiveStore, jobId: string, itemId: string, path: string, config: ArchiveConfig, signal: AbortSignal): Promise<ArchiveItem> {
  const item = store.items(jobId).find(i => i.id === itemId); if (!item) throw new Error('附件任务不存在');
  const metadata = await stat(path); if (!metadata.isFile() || metadata.size === 0 || metadata.size > config.maxFileBytes) throw new Error('导入文件为空或超过限制');
  const bytes = await readFile(path); if (!bytes.length || bytes.length > config.maxFileBytes) throw new Error('导入文件大小变化或超限');
  const prefix = bytes.subarray(0,1024).toString('utf8').trim();
  if (/^<!doctype\s+html|^<html/i.test(prefix)) throw new Error('不能把 HTML 登录页导入为附件');
  const parsed = await parseIsolated(bytes, config, signal);
  await store.save(item, bytes, parsed, item.candidate.url, 'manual-import');
  await store.event(jobId, 'manual-import', { itemId: item.id, sha256: item.sha256, status: item.status });
  const status = store.items(jobId).every(i => i.status === 'complete') ? 'complete' : 'partial';
  await store.setStatus(jobId, status); return item;
}
