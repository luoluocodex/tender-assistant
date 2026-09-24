import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { executePreview, resumePreview, reconcilePreview } from '../../src/notify/run.js';
import { loadLedger, saveLedger, recordDelivery } from '../../src/notify/ledger.js';
import { LocalPreview, previewPath } from '../../src/notify/channel.js';
import { verifyNotifications } from '../../src/notify/verify.js';
import { ArchiveStore, backupArchive, restoreArchive } from '../../src/store/archive-store.js';
import type { PreviewChannel } from '../../src/notify/model.js';
import { clock, notifyFixture } from './notify-fixtures.js';

test('P5 已知失败需显式恢复并遵守次数上限；重复预览不自动重试失败', async () => {
  const { root, value, config } = await notifyFixture(); let calls = 0;
  const channel: PreviewChannel = { async deliver() { calls++; return { state: 'failed', receiptHash: null, errorCode: 'SYNTHETIC_FAILURE' }; }, async inspect() { throw new Error('not used'); } };
  const failed = await executePreview(root, config, 'diagnostic', async () => value, { now: clock, channel });
  assert.equal(failed.status, 'partial'); assert.equal(calls, 2);
  await executePreview(root, config, 'diagnostic', async () => value, { now: clock, channel }); assert.equal(calls, 2);
  await resumePreview(root, config, failed.id, { channel }); await resumePreview(root, config, failed.id, { channel });
  await resumePreview(root, config, failed.id, { channel }); assert.equal(calls, 6);
  assert.ok((await loadLedger(root)).deliveries.every(d => d.state === 'failed' && d.attempts === 3));
});

test('P5 写入后回执丢失不重发，核对成功恢复；进程遗留 writing 变为 unknown', async () => {
  const { root, value, config } = await notifyFixture(); const local = new LocalPreview(root);
  const uncertain: PreviewChannel = { async deliver(d) { await local.deliver(d); throw new Error('synthetic-lost-receipt'); }, inspect: d => local.inspect(d) };
  const run = await executePreview(root, config, 'diagnostic', async () => value, { now: clock, channel: uncertain });
  assert.equal(run.counts.unknown, 2);
  const resumed = await resumePreview(root, config, run.id); assert.equal(resumed.counts.unknown, 2);
  let ledger = await loadLedger(root); assert.ok(ledger.deliveries.every(d => d.attempts === 1));
  ledger.deliveries[0]!.state = 'writing'; recordDelivery(ledger.deliveries[0]!); await saveLedger(root, ledger);
  await resumePreview(root, config, run.id); ledger = await loadLedger(root);
  assert.equal(ledger.deliveries[0]!.state, 'unknown');
  for (const d of ledger.deliveries) assert.equal((await reconcilePreview(root, d.id)).state, 'previewed');
  assert.equal((await resumePreview(root, config, run.id)).status, 'complete');
  assert.equal((await verifyNotifications(root)).ok, true);
  assert.ok((await loadLedger(root)).deliveries[0]!.history.some(h => h.errorCode === 'CHANNEL_RESULT_UNKNOWN'));
});

test('P5 取消保留未处理项，恢复不重复成功项；内容冲突保持未知不覆盖', async () => {
  const { root, value, config } = await notifyFixture(); const controller = new AbortController(), local = new LocalPreview(root);
  const channel: PreviewChannel = { async deliver(d) { const result = await local.deliver(d); controller.abort(); return result; }, inspect: d => local.inspect(d) };
  const run = await executePreview(root, config, 'diagnostic', async () => value, { now: clock, channel, signal: controller.signal });
  assert.equal(run.status, 'cancelled'); assert.equal(run.counts.previewed, 1); assert.equal(run.counts.pending, 1);
  const resumed = await resumePreview(root, config, run.id); assert.equal(resumed.status, 'complete');
  const ledger = await loadLedger(root); assert.ok(ledger.deliveries.every(d => d.attempts === 1));
  const d = ledger.deliveries[0]!; await writeFile(previewPath(root, d.id), 'synthetic-conflict');
  assert.equal((await verifyNotifications(root)).ok, false);
  assert.equal((await reconcilePreview(root, d.id)).state, 'unknown');
  await resumePreview(root, config, run.id);
  assert.equal(await readFile(previewPath(root, d.id), 'utf8'), 'synthetic-conflict');
});

test('P5 随归档一致备份恢复后保持去重与回执；篡改账本拒绝加载', async () => {
  const { root, value, config } = await notifyFixture(); await executePreview(root, config, 'diagnostic', async () => value, { now: clock });
  const store = new ArchiveStore(root); let backup;
  try { backup = await backupArchive(store); } finally { store.close(); }
  const target = join(root, 'synthetic-restore'); await restoreArchive(backup.path, target);
  assert.deepEqual(await loadLedger(target), await loadLedger(root)); assert.equal((await verifyNotifications(target)).ok, true);
  const repeat = await executePreview(target, config, 'diagnostic', async () => value, { now: clock });
  assert.equal(repeat.added, 0); assert.equal(repeat.reused, 2);
  const file = join(target, 'runs/p5-notifications/ledger.json'); const data = JSON.parse(await readFile(file, 'utf8')); data.payload += ' ';
  await writeFile(file, JSON.stringify(data)); await assert.rejects(loadLedger(target), /P5_LEDGER_HASH_MISMATCH/);
});
