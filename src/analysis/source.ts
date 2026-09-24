import { readFile } from 'node:fs/promises';
import { object, string } from '../archive/config.js';
import { displayUrl } from '../archive/source.js';
import { ArchiveStore } from '../store/archive-store.js';
import { sha256, inside } from '../store/files.js';
import { analysisFields } from './fields.js';
import type { Listing, QueryWindow } from '../model.js';
import type { Notice, AttachmentText } from './model.js';

const nullable = (v: unknown): string | null => v === null ? null : string(v);
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('INVALID_SOURCE_ARRAY'); return v; };
/** 保留 P1 已观察的公开路由参数；普通日志使用 displayUrl，公告回溯不能丢失 hash 路由。 */
export function noticeUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_NOTICE_URL');
  const allowed = new Set(['noticeId', 'projectCode', 'bizCode', 'siteCode', 'publishDate', 'source', 'titleDetails', 'classify']);
  const clean = (params: URLSearchParams): string => {
    for (const key of [...params.keys()]) if (!allowed.has(key)) params.delete(key);
    params.sort(); return params.toString();
  };
  url.username = ''; url.password = ''; url.search = clean(url.searchParams);
  if (url.hash.startsWith('#/')) {
    const [route, query = ''] = url.hash.slice(1).split('?'); const params = clean(new URLSearchParams(query));
    url.hash = `${route}${params ? '?' + params : ''}`;
  } else url.hash = '';
  return url.href;
}
/** 模型输入不携带网页 URL 查询串或认证头；原始证据仍由 P1/P2 保存。 */
export function safeText(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"'（）。，；、)]+/g, url => { try { return displayUrl(url); } catch { return '[URL]'; } })
    .replace(/(?:Authorization|Cookie|Set-Cookie)\s*:[^\r\n]+/gi, '[AUTH REDACTED]')
    .replace(/\b(?:access_code|accessCode|token|password|signature)\s*[=:]\s*[^\s&,;]+/gi, '[SECRET REDACTED]');
}
function listing(value: unknown): Listing {
  const v = object(value); const url = new URL(string(v.url));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_NOTICE_URL');
  return { site: string(v.site), id: string(v.id), title: safeText(string(v.title)), url: noticeUrl(url.href),
    publishedAt: nullable(v.publishedAt), region: nullable(v.region), noticeType: nullable(v.noticeType), evidence: safeText(string(v.evidence)) };
}
function window(value: unknown): QueryWindow {
  const w = object(value);
  const startDate = string(w.startDate), endDate = string(w.endDate), startAt = string(w.startAt), endAt = string(w.endAt);
  if (w.timezone !== 'Asia/Shanghai' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(startAt) > Date.parse(endAt)) throw new Error('INVALID_WINDOW');
  return { startDate, endDate, startAt, endAt, timezone: 'Asia/Shanghai' };
}
async function attachments(root: string, jobId: string | undefined, textByKey: Map<string, string>): Promise<Map<string, AttachmentText[]>> {
  const result = new Map<string, AttachmentText[]>(); if (!jobId) return result;
  const store = new ArchiveStore(root);
  try {
    store.job(jobId);
    for (const item of store.items(jobId)) {
      const original = object(item.candidate.noticePayload); const l = object(original.listing);
      const key = `${string(l.site)}:${string(l.id)}`;
      if (!textByKey.has(key)) continue;
      if (textByKey.get(key) !== safeText(string(original.text))) throw new Error('ARCHIVE_NOTICE_VERSION_MISMATCH');
      if (!item.objectPath || !item.parsePath || !item.sha256) continue;
      const bytes = await readFile(inside(root, item.objectPath)); const parsedBytes = await readFile(inside(root, item.parsePath));
      const stored = store.file(item.sha256); const parseSha = sha256(parsedBytes);
      // P2 早期任务项没有 parseSha；优先用对象表的完整指纹，再兼容旧解析文件名的指纹。
      const expected = item.parseSha ?? (stored?.parsePath === item.parsePath ? stored.parseSha : null) ?? /-([a-f0-9]{12})\.json$/.exec(item.parsePath)?.[1];
      if (sha256(bytes) !== item.sha256 || !expected || !parseSha.startsWith(expected)) throw new Error('ARCHIVE_INTEGRITY_FAILURE');
      const parsed = object(JSON.parse(parsedBytes.toString('utf8')));
      const units = list(parsed.units).map(raw => { const v = object(raw); return { locator: string(v.locator), text: safeText(string(v.text)) }; });
      const status = item.sourceReviewRequired ? 'source-review-required' : item.status === 'complete' ? string(parsed.status) : `archive-${item.status}:${string(parsed.status)}`;
      const file = { name: safeText(item.candidate.name), sha256: item.sha256, parseSha, status, units, ...(item.observation ? { observation: item.observation } : {}) };
      const existing = result.get(key) ?? [];
      if (!existing.some(x => x.sha256 === file.sha256 && x.parseSha === file.parseSha)) existing.push(file);
      result.set(key, existing);
    }
  } finally { store.close(); }
  return result;
}
/** 导入一个目的明确的 P1 快照，不混入另一诊断/正式运行；无详情候选也必须进入清单。 */
export async function readSource(path: string, root: string, jobId?: string): Promise<{ notices: Notice[]; purpose: 'formal' | 'diagnostic'; reportHash: string }> {
  const bytes = await readFile(path); const r = object(JSON.parse(bytes.toString('utf8')));
  if (r.phase !== 'P1' || (r.purpose !== 'formal' && r.purpose !== 'diagnostic')) throw new Error('INVALID_P1_REPORT');
  const purpose = r.purpose; const w = window(r.window);
  const rows = new Map<string, { listing: Listing; complete: boolean; queries: string[] }>();
  for (const raw of list(r.queries)) {
    const q = object(raw);
    for (const v of [...list(q.listings), ...list(q.excluded).map(e => object(e).listing)]) {
      const l = listing(v); const key = `${l.site}:${l.id}`; const previous = rows.get(key);
      rows.set(key, { listing: previous?.listing ?? l, complete: (previous?.complete ?? true) && q.status === 'complete', queries: [...(previous?.queries ?? []), string(q.id)] });
    }
  }
  const details = new Map<string, Record<string, unknown>>(); const texts = new Map<string, string>();
  for (const raw of list(r.details)) {
    const d = object(raw); const l = listing(d.listing); const key = `${l.site}:${l.id}`;
    if (details.has(key)) throw new Error('DUPLICATE_DETAIL');
    if (typeof d.text !== 'string') throw new Error('INVALID_DETAIL_TEXT');
    if (d.text && sha256(d.text) !== d.sha256) throw new Error('P1_BODY_HASH_MISMATCH');
    details.set(key, d); texts.set(key, safeText(d.text));
    if (!rows.has(key)) rows.set(key, { listing: l, complete: false, queries: [] });
  }
  const files = await attachments(root, jobId, texts);
  const notices = [...rows].map(([key, row]): Notice => {
    const detail = details.get(key); const text = texts.get(key) ?? ''; const saved = files.get(key) ?? [];
    const completeness = detail ? string(detail.status) : 'not-collected';
    const attachmentCount = detail ? list(detail.attachments).length : null;
    const fields = analysisFields(text);
    const stable = { listing: row.listing, text, completeness, attachmentCount, files: saved.map(f => ({ sha256: f.sha256, parseSha: f.parseSha, status: f.status })) };
    return { key, version: sha256(JSON.stringify(stable)), purpose, listing: row.listing, text, completeness, fields,
      fetchedAt: detail ? string(detail.fetchedAt) : null, attachmentCount, attachments: saved,
      window: w, queryComplete: row.complete, queryIds: [...new Set(row.queries)].sort() };
  });
  return { notices, purpose, reportHash: sha256(bytes) };
}
