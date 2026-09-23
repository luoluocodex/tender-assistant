import type { BrowserContext } from 'playwright';
import type { ArchiveConfig } from './model.js';
import { ArchiveError } from './model.js';
import { allowedUrl } from './source.js';

/** 有上限的流式下载；Cookie 仅从指定浏览器会话按目标 URL 获取，不写日志。 */
export async function downloadFile(url: string, referer: string, config: ArchiveConfig, signal: AbortSignal, session?: BrowserContext): Promise<{ bytes: Buffer; finalUrl: string; contentType: string }> {
  let target = allowedUrl(url, config);
  for (let redirect = 0; redirect <= 5; redirect++) {
    signal.throwIfAborted();
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 TenderAssistant/P2', Referer: referer };
    if (session) {
      const cookies = await session.cookies(target.href);
      if (cookies.length) headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const response = await fetch(target, { headers, redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel(); const location = response.headers.get('location');
      if (!location) throw new ArchiveError('REDIRECT_WITHOUT_LOCATION');
      const next = allowedUrl(new URL(location, target).href, config);
      if (target.protocol === 'https:' && next.protocol === 'http:') throw new ArchiveError('HTTPS_DOWNGRADE', 'needs-human');
      target = next; continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ArchiveError(`HTTP_${response.status}`, response.status === 429 ? 'limited' : [401, 403].includes(response.status) ? 'needs-human' : 'failed');
    }
    const type = response.headers.get('content-type') ?? '';
    if (/text\/html|application\/xhtml/i.test(type)) { await response.body?.cancel(); throw new ArchiveError('HTML_INSTEAD_OF_ATTACHMENT', 'needs-human'); }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > config.maxFileBytes) { await response.body?.cancel(); throw new ArchiveError('FILE_TOO_LARGE'); }
    if (!response.body) throw new ArchiveError('EMPTY_RESPONSE');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
        total += next.value.length;
        if (total > config.maxFileBytes) throw new ArchiveError('FILE_TOO_LARGE');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (total === 0) throw new ArchiveError('EMPTY_FILE');
    const bytes = Buffer.concat(chunks);
    const start = bytes.subarray(0, 1024).toString('utf8').trimStart();
    if (/^(?:<!doctype\s+html|<html|<head|<script|<\?xml[^>]*>\s*<html)/i.test(start)) throw new ArchiveError('HTML_INSTEAD_OF_ATTACHMENT', 'needs-human');
    return { bytes, finalUrl: target.href, contentType: type };
  }
  throw new ArchiveError('TOO_MANY_REDIRECTS');
}
