import { readFile, readdir } from 'node:fs/promises';
import { object, string, readObservation } from '../archive/config.js';
import { atomicFile, inside, sha256 } from '../store/files.js';
import { companyContract } from './contract.js';
import type { AnalysisSnapshot, AttachmentText, Notice, Packet, RuleConfig } from './model.js';
import { makePacket } from './packets.js';
import { associate } from './rules.js';
import { readStoredFields } from './fields.js';
import { validateResult, type ValidatedAnalysis } from './validation.js';

export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('INVALID_SNAPSHOT_ARRAY'); return v; };
const emptyText = (v: unknown): string => { if (typeof v !== 'string') throw new Error('INVALID_SNAPSHOT_TEXT'); return v; };
const nullable = (v: unknown): string | null => v === null ? null : string(v);
const boolean = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error('INVALID_SNAPSHOT_BOOLEAN'); return v; };
export function runPath(root: string, id: string): string {
  if (!/^p3-[a-f0-9]{24}$/.test(id)) throw new Error('INVALID_P3_RUN_ID');
  return inside(root, `runs/${id}`);
}
function rules(value: unknown): RuleConfig {
  const v = object(value); return { version: string(v.version), keyword: string(v.keyword), region: string(v.region), excludeKeywords: array(v.excludeKeywords).map(string) };
}
function parseNotice(value: unknown): Notice {
  const v = object(value), l = object(v.listing), w = object(v.window);
  if (v.purpose !== 'formal' && v.purpose !== 'diagnostic') throw new Error('INVALID_PURPOSE');
  if (w.timezone !== 'Asia/Shanghai' || (v.attachmentCount !== null && (!Number.isInteger(v.attachmentCount) || Number(v.attachmentCount) < 0))) throw new Error('INVALID_NOTICE');
  const attachments: AttachmentText[] = array(v.attachments).map(raw => {
    const f = object(raw); return { name: string(f.name), sha256: string(f.sha256), parseSha: string(f.parseSha), status: string(f.status),
      units: array(f.units).map(rawUnit => { const u = object(rawUnit); return { locator: string(u.locator), text: emptyText(u.text) }; }),
      ...(f.observation === undefined ? {} : { observation: readObservation(f.observation) }) };
  });
  const text = emptyText(v.text);
  return { key: string(v.key), version: string(v.version), purpose: v.purpose,
    listing: { site: string(l.site), id: string(l.id), title: string(l.title), url: string(l.url), publishedAt: nullable(l.publishedAt), region: nullable(l.region), noticeType: nullable(l.noticeType), evidence: string(l.evidence) },
    text, completeness: string(v.completeness), fields: readStoredFields(v.fields), fetchedAt: nullable(v.fetchedAt),
    attachmentCount: v.attachmentCount === null ? null : Number(v.attachmentCount), attachments,
    window: { timezone: 'Asia/Shanghai', startAt: string(w.startAt), endAt: string(w.endAt), startDate: string(w.startDate), endDate: string(w.endDate) },
    queryComplete: boolean(v.queryComplete), queryIds: array(v.queryIds).map(string) };
}
/** 对持久化边界重新校验类型并重建包；不能用类型断言直接信任磁盘 JSON。 */
export function readPacket(value: unknown): Packet {
  const v = object(value); const p = object(v.prompts);
  const prompts = Object.fromEntries(Object.entries(p).map(([key, val]) => [key, string(val)]));
  const packet = makePacket(parseNotice(v.notice), rules(v.rules), prompts, v.company === null ? null : companyContract.parse(v.company), boolean(object(v.decision).tracked));
  // 比较语义 JSON，不依赖磁盘字段顺序。
  const stable = (value: unknown): string => JSON.stringify(value, (_, val: unknown) => val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);
  if (stable(packet) !== stable(v)) throw new Error('SNAPSHOT_PACKET_MISMATCH');
  return packet;
}
export async function saveSnapshot(root: string, snapshot: AnalysisSnapshot): Promise<void> {
  const dir = runPath(root, snapshot.id); const contents = json(snapshot);
  await atomicFile(inside(dir, 'snapshot.json'), contents);
  await atomicFile(inside(dir, 'snapshot.sha256'), sha256(contents));
  for (const packet of snapshot.packets) await atomicFile(inside(dir, `packets/${packet.packetId}.json`), json(packet));
}
export async function loadSnapshot(root: string, id: string): Promise<AnalysisSnapshot> {
  const dir = runPath(root, id); const bytes = await readFile(inside(dir, 'snapshot.json'));
  if (sha256(bytes) !== await readFile(inside(dir, 'snapshot.sha256'), 'utf8')) throw new Error('SNAPSHOT_HASH_MISMATCH');
  const v = object(JSON.parse(bytes.toString('utf8')));
  if (v.phase !== 'P3' || v.schemaVersion !== 1 || v.id !== id || (v.purpose !== 'formal' && v.purpose !== 'diagnostic')) throw new Error('INVALID_SNAPSHOT');
  const packets = array(v.packets).map(readPacket);
  return { schemaVersion: 1, phase: 'P3', id, createdAt: string(v.createdAt), purpose: v.purpose, reportHash: string(v.reportHash), sourceReport: string(v.sourceReport),
    rules: rules(v.rules), packets, projects: associate(packets.map(p => p.notice)), p3AcceptanceComplete: false };
}
/** 结果按内容指纹保留历史；每个包的 latest 指针只在验证成功后更新。 */
export async function importResult(root: string, snapshot: AnalysisSnapshot, raw: unknown): Promise<{ reused: boolean; packetId: string }> {
  const v = object(raw); const packet = snapshot.packets.find(p => p.packetId === v.packetId);
  if (!packet) throw new Error('UNKNOWN_PACKET');
  const result = validateResult(raw, packet); const hash = sha256(json(result.original));
  const dir = runPath(root, snapshot.id); const path = `results/${packet.packetId}/${hash}.json`;
  let reused = false;
  try { reused = await readFile(inside(dir, path), 'utf8') === json(result); } catch { /* 首次导入 */ }
  if (!reused) await atomicFile(inside(dir, path), json(result));
  await atomicFile(inside(dir, `results/${packet.packetId}/latest.json`), json({ hash }));
  return { reused, packetId: packet.packetId };
}
export async function readResults(root: string, snapshot: AnalysisSnapshot): Promise<Map<string, ValidatedAnalysis>> {
  const result = new Map<string, ValidatedAnalysis>(); const dir = runPath(root, snapshot.id);
  for (const packet of snapshot.packets) {
    const folder = inside(dir, `results/${packet.packetId}`);
    try { await readdir(folder); } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') continue; throw e; }
    const hash = string(object(JSON.parse(await readFile(inside(folder, 'latest.json'), 'utf8'))).hash);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_RESULT_HASH');
    const stored = object(JSON.parse(await readFile(inside(folder, `${hash}.json`), 'utf8')));
    const validated = validateResult(stored.original, packet);
    if (sha256(json(validated.original)) !== hash || json(validated) !== json(stored)) throw new Error('RESULT_INTEGRITY_FAILURE');
    result.set(packet.packetId, validated);
  }
  return result;
}
