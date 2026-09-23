import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { selectSnapshot } from '../../src/assistant/catalog.js';
import { resultView, queueView, packetView, page } from '../../src/assistant/views.js';
import { importResult, saveSnapshot } from '../../src/analysis/persistence.js';
import { notice, packet, snapshot, modelResult } from './analysis-fixtures.js';

async function fixture() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'p4-synthetic-'));
}

test('P4 最新正式快照不回退诊断；按创建时间选择；损坏与用途冲突明确失败', async () => {
  const root = await fixture(); assert.equal(await selectSnapshot(root, 'formal'), null);
  const diagnostic = snapshot(); await saveSnapshot(root, diagnostic);
  assert.equal(await selectSnapshot(root, 'formal'), null);
  await assert.rejects(selectSnapshot(root, 'formal', diagnostic.id), /PURPOSE_MISMATCH/);
  const oldNotice = notice('formal-old'); oldNotice.purpose = 'formal';
  const old = snapshot([packet(oldNotice)]); old.purpose = 'formal'; old.createdAt = '2026-09-21T00:00:00Z';
  const newNotice = notice('formal-new'); newNotice.purpose = 'formal';
  const current = snapshot([packet(newNotice)]); current.purpose = 'formal';
  await saveSnapshot(root, current); await saveSnapshot(root, old);
  assert.equal((await selectSnapshot(root, 'formal'))?.id, current.id);
  const path = join(root, 'runs', current.id, 'snapshot.json');
  await writeFile(path, await readFile(path, 'utf8') + ' ');
  await assert.rejects(selectSnapshot(root, 'formal'), /SNAPSHOT_HASH_MISMATCH/);
});

test('P4 清单和队列只计当前版本，已分析、正文缺失与规则排除各自保留计数', async () => {
  const root = await fixture();
  const old = notice('versioned'); old.fetchedAt = '2026-09-20T00:00:00Z';
  const current = notice('versioned', '合成网站开发更正公告', '项目编号：TEST-1\n采购人：合成采购方\n变更后测试正文');
  const missing = notice('missing'); missing.completeness = 'not-collected'; missing.text = '';
  const excluded = notice('excluded'); excluded.listing.region = '北京';
  const analyzed = packet(notice('analyzed'));
  const value = snapshot([packet(old), packet(current), packet(missing), packet(excluded), analyzed]);
  await saveSnapshot(root, value); await importResult(root, value, modelResult(analyzed));
  const view = await resultView(root, value, 0, 10);
  assert.equal(view.totalVersions, 5); assert.equal(view.counts.candidates, 4);
  assert.equal(view.counts.modelAnalyzed, 1); assert.equal(view.counts.pending, 3);
  assert.equal(view.items[0]?.packetId, analyzed.packetId);
  assert.equal(view.items[0]?.eligibility, 'insufficient-company-data');
  assert.equal(view.items.some(p => p.packetId === packet(old).packetId), false);
  const queue = await queueView(root, value, 0, 1);
  assert.equal(queue.pending, 3); assert.equal(queue.ready, 1); assert.equal(queue.deferred, 2);
  assert.equal(queue.items[0]?.packetId, packet(current).packetId);
  assert.equal(queue.nextOffset, null);
});

test('P4 证据分页完整往返并保留引文与版本，拒绝未知包和越界', () => {
  const p = packet(notice('large', '合成网站开发', '合成证据'.repeat(2500)));
  const value = snapshot([p]); const collected = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const result = packetView(value, p.packetId, offset, 1);
    assert.equal(result.inputHash, p.inputHash);
    assert.deepEqual(result.prompts, offset === 0 ? p.prompts : null);
    collected.push(...result.items); offset = result.nextOffset;
  }
  assert.deepEqual(collected, p.evidence);
  assert.throws(() => packetView(value, 'unknown', 0, 1), /UNKNOWN_PACKET/);
  assert.throws(() => packetView(value, p.packetId, p.evidence.length + 1, 1), /INVALID_PAGE/);
  assert.throws(() => packetView(value, p.packetId, 0, 11), /LIMIT_EXCEEDED/);
  assert.throws(() => page([], -1, 1), /INVALID_PAGE/);
  assert.deepEqual(page([], 0, 1), { total: 0, offset: 0, nextOffset: null, items: [] });
});

test('P4 已持久化模型结果损坏不能被清单或队列静默忽略', async () => {
  const root = await fixture(); const value = snapshot(); const p = value.packets[0]!;
  await saveSnapshot(root, value); await importResult(root, value, modelResult(p));
  await writeFile(join(root, 'runs', value.id, 'results', p.packetId, 'latest.json'), '{"hash":"tampered"}');
  await assert.rejects(resultView(root, value, 0, 10), /INVALID_RESULT_HASH/);
  await assert.rejects(queueView(root, value, 0, 10), /INVALID_RESULT_HASH/);
});
