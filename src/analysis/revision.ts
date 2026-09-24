import type { ArchiveObservation } from '../archive/model.js';
import type { Notice } from './model.js';
import { sha256 } from '../store/files.js';

export interface MaterialRevision {
  bodyHash: string; fetchedAt: string | null;
  attachments: Array<{ contentHash: string; observation: ArchiveObservation | null }>;
}
/** 正文和附件分别标记观察来源，附件更新不伪造正文抓取时间。 */
export function materialRevision(n: Notice): MaterialRevision {
  return { bodyHash: sha256(JSON.stringify({ listing: n.listing, text: n.text, completeness: n.completeness, attachmentCount: n.attachmentCount })), fetchedAt: n.fetchedAt,
    attachments: n.attachments.map(f => ({ contentHash: sha256(JSON.stringify([f.sha256, f.parseSha, f.status])), observation: f.observation ?? null })) };
}

/** 比较同一公告的材料；1 为明确更新，-1 为回退，0 为相同内容，null 为无法排序。 */
export function compareRevision(before: MaterialRevision, after: MaterialRevision): -1 | 0 | 1 | null {
  const oldTime = Date.parse(before.fetchedAt ?? ''), newTime = Date.parse(after.fetchedAt ?? '');
  const knownTime = Number.isFinite(oldTime) && Number.isFinite(newTime);
  if (knownTime && newTime < oldTime) return -1;
  if (before.bodyHash !== after.bodyHash && !(knownTime && newTime > oldTime)) return null;
  const sameAttachments = JSON.stringify(before.attachments.map(a => a.contentHash).sort()) === JSON.stringify(after.attachments.map(a => a.contentHash).sort());
  let advanced = false;
  for (const old of before.attachments) {
    const prior = old.observation;
    const next = prior ? after.attachments.find(a => a.observation?.archiveId === prior.archiveId && a.observation.attachmentId === prior.attachmentId)
      : after.attachments.find(a => a.contentHash === old.contentHash);
    if (!next) {
      // 无观察元数据的旧附件只允许被新归档机制的完整观察集合替换，反向不允许。
      if (!prior && after.attachments.length >= before.attachments.length && after.attachments.every(a => a.observation)) { advanced = true; continue; }
      return null;
    }
    if (prior && next.observation) {
      if (next.observation.revision < prior.revision) return -1;
      if (next.contentHash !== old.contentHash && next.observation.revision === prior.revision) return null;
      if (next.observation.revision > prior.revision) advanced = true;
    }
  }
  for (const next of after.attachments) if (!before.attachments.some(old => old.contentHash === next.contentHash)) {
    if (!next.observation) return null;
    advanced = true;
  }
  if (!sameAttachments && !advanced) return null;
  return before.bodyHash !== after.bodyHash || !sameAttachments || (knownTime && newTime > oldTime) ? 1 : 0;
}
