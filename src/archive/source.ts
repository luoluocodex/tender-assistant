import { readFile } from 'node:fs/promises';
import { object, string } from './config.js';
import type { ArchiveConfig, Candidate } from './model.js';
import { ArchiveError } from './model.js';
import { sha256 } from '../store/files.js';

/** 普通输出只保留源站及路径，不泄漏 query、fragment 或用户信息。 */
export function displayUrl(raw: string): string { const u = new URL(raw); return `${u.origin}${u.pathname}`; }
export function canonicalUrl(raw: string): string {
  const u = new URL(raw); u.username = ''; u.password = ''; u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/token|signature|sign$|access.?code|auth|credential|expires|password/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); return u.href;
}
/** 每一次重定向都校验范围；未登记来源返回人工核验，不自动扩展。 */
export function allowedUrl(raw: string, config: ArchiveConfig): URL {
  const u = new URL(raw);
  if (u.username || u.password || !config.sources.some(s => s.origin === u.origin && u.pathname.startsWith(s.pathPrefix))) throw new ArchiveError('UNREGISTERED_SOURCE', 'needs-human');
  return u;
}

/** 显式选择 P1 报告中的附件序号，不遍历或下载全部候选。 */
export async function candidates(reportPath: string, picks: string[], config: ArchiveConfig): Promise<Candidate[]> {
  const report = object(JSON.parse(await readFile(reportPath, 'utf8')));
  if (report.phase !== 'P1' || !['formal', 'diagnostic'].includes(String(report.purpose)) || !Array.isArray(report.details)) throw new Error('需要有效 P1 报告');
  const details = report.details;
  if (!picks.length || picks.length > config.maxFiles) throw new Error('必须显式选择附件且不能超过文件上限');
  return picks.map(pick => {
    const match = /^([^:]+):(\d+)$/.exec(pick); if (!match) throw new Error('附件选择格式为 公告ID:从0开始的附件序号');
    const values = details.filter(value => object(object(value).listing).id === match[1]);
    if (values.length !== 1) throw new Error('公告ID缺失或不唯一');
    const detail = object(values[0]); const listing = object(detail.listing);
    const noticeUrl = string(listing.url);
    if (!['www.ccgp.gov.cn', 'ygp.gdzwfw.gov.cn'].includes(new URL(noticeUrl).hostname)) throw new Error('公告来源不在 P1 范围');
    if (!Array.isArray(detail.attachments)) throw new Error('附件清单缺失');
    const file = object(detail.attachments[Number(match[2])]); const url = string(file.url); allowedUrl(url, config);
    const noticeKey = sha256(`${string(listing.site)}:${string(listing.id)}`);
    const payload = { listing, title: detail.title, text: string(detail.text), fields: detail.fields, attachments: detail.attachments };
    const stablePayload = { title: detail.title, text: payload.text, fields: detail.fields, url: canonicalUrl(noticeUrl), attachments: detail.attachments.map(a => { const item = object(a); return { name: string(item.name), url: canonicalUrl(string(item.url)) }; }) };
    const noticeVersion = sha256(`${noticeKey}:${JSON.stringify(stablePayload)}`);
    return { purpose: report.purpose === 'formal' ? 'formal' : 'diagnostic', noticeKey, noticeVersion, noticeId: string(listing.id),
      noticeUrl, title: string(listing.title), noticePayload: payload, attachmentId: sha256(`${noticeVersion}:${canonicalUrl(url)}`), name: string(file.name), url };
  });
}
