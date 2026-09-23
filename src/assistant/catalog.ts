import { readdir, readFile } from 'node:fs/promises';
import { object, string } from '../archive/config.js';
import { inside, sha256 } from '../store/files.js';
import { loadSnapshot, runPath } from '../analysis/persistence.js';
import type { AnalysisSnapshot } from '../analysis/model.js';

export type Purpose = 'formal' | 'diagnostic';
/** 仅选择指定用途；目录不存在视为未分析，损坏数据报错，不退回其他历史结果。 */
export async function selectSnapshot(root: string, purpose: Purpose, id?: string): Promise<AnalysisSnapshot | null> {
  if (id) {
    const snapshot = await loadSnapshot(root, id);
    if (snapshot.purpose !== purpose) throw new Error('PURPOSE_MISMATCH: 诊断任务需要 --purpose diagnostic');
    return snapshot;
  }
  let entries;
  try { entries = await readdir(inside(root, 'runs'), { withFileTypes: true }); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  const candidates: Array<{ id: string; createdAt: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^p3-[a-f0-9]{24}$/.test(entry.name)) continue;
    const dir = runPath(root, entry.name);
    const bytes = await readFile(inside(dir, 'snapshot.json'));
    if (sha256(bytes) !== await readFile(inside(dir, 'snapshot.sha256'), 'utf8')) throw new Error(`SNAPSHOT_HASH_MISMATCH: ${entry.name}`);
    const header = object(JSON.parse(bytes.toString('utf8')));
    if (header.schemaVersion !== 1 || header.phase !== 'P3' || header.id !== entry.name || !['formal', 'diagnostic'].includes(string(header.purpose))) throw new Error('INVALID_SNAPSHOT_HEADER');
    const createdAt = Date.parse(string(header.createdAt));
    if (!Number.isFinite(createdAt)) throw new Error('INVALID_SNAPSHOT_DATE');
    if (header.purpose === purpose) candidates.push({ id: entry.name, createdAt });
  }
  candidates.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return candidates[0] ? loadSnapshot(root, candidates[0].id) : null;
}
