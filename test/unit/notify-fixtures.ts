import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeRoot, sha256 } from '../../src/store/files.js';
import { json, saveSnapshot, importResult } from '../../src/analysis/persistence.js';
import type { Packet } from '../../src/analysis/model.js';
import type { NotifyConfig } from '../../src/notify/model.js';
import { fixtureRoot } from './archive-fixtures.js';
import { notice, packet, snapshot, modelResult } from './analysis-fixtures.js';

export const notifyTestConfig: NotifyConfig = { schemaVersion: 1, channel: 'local-preview', recipient: 'synthetic-user',
  externalSendingEnabled: false, scheduleEnabled: false, deadlineHours: [72, 24], maxAttempts: 3 };
export const clock = new Date('2026-09-23T10:00:00Z');
export function tender(id = 'notify-1', body = '提交投标文件截止时间：2026年09月25日18:00:00') {
  return packet(notice(id, '合成网站开发采购公告', `项目编号：P5-${id}\n采购人：合成采购方\n具备测试资质甲级\n${body}`));
}
export async function notifyFixture(packets: Packet[] = [tender()], partial = false, analyzed = true) {
  const root = await fixtureRoot(); await initializeRoot(root, false);
  const value = snapshot(packets); const report = json({ phase: 'P1', purpose: 'diagnostic', status: partial ? 'partial' : 'complete',
    queries: [{ id: 'synthetic-query', site: 'synthetic', status: partial ? 'needs-human' : 'complete', reason: partial ? '需要人工登录；Cookie: sensitive-fixture' : '完整' }] });
  value.sourceReport = join(root, 'source-p1.json'); value.reportHash = sha256(report);
  await writeFile(value.sourceReport, report); await saveSnapshot(root, value);
  if (analyzed) for (const p of packets) await importResult(root, value, modelResult(p));
  return { root, value, config: notifyTestConfig };
}
