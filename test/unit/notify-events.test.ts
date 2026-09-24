import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { deadlineBucket, deadlineInstant } from '../../src/notify/deadline.js';
import { planEvents } from '../../src/notify/events.js';
import { executePreview } from '../../src/notify/run.js';
import { loadLedger } from '../../src/notify/ledger.js';
import { makePacket } from '../../src/analysis/packets.js';
import { importResult, saveSnapshot } from '../../src/analysis/persistence.js';
import { snapshot, notice, packet, modelResult, testPrompts, testRules } from './analysis-fixtures.js';
import { clock, notifyFixture, tender } from './notify-fixtures.js';

test('P5 临期按北京时间、窗口和精度识别；无日期、非法日期和过期不提醒', () => {
  const date = deadlineInstant('2026年09月25日18:00:00')!;
  assert.equal(new Date(date).toISOString(), '2026-09-25T10:00:00.000Z');
  assert.equal(deadlineBucket(date, clock.getTime(), [72, 24]), 72);
  assert.equal(deadlineBucket(date, date - 24 * 3600000, [72, 24]), 24);
  assert.equal(deadlineBucket(date, date, [72, 24]), null);
  assert.equal(deadlineBucket(date, date - 73 * 3600000, [72, 24]), null);
  for (const raw of ['2026-09-25', '2026-02-30 12:00', '2026-01-01 24:00', '2026-01-01 12:60', '未知']) assert.equal(deadlineInstant(raw), null);
});

test('P5 相同内容跨快照去重，临期进入下一窗口只增加一次；用途与对象分开', async () => {
  const { root, value, config } = await notifyFixture();
  const first = await executePreview(root, config, 'diagnostic', async () => value, { now: clock });
  assert.equal(first.status, 'complete'); assert.equal(first.added, 2);
  assert.ok(first.deliveries.some(d => d.type === 'deadline'));
  const repeat = await executePreview(root, config, 'diagnostic', async () => value, { now: clock });
  assert.equal(repeat.added, 0); assert.equal(repeat.reused, 2);
  const refreshed = structuredClone(value.packets[0]!.notice); refreshed.fetchedAt = '2026-09-24T10:00:00Z';
  const refreshedPacket = packet(refreshed); const fresh = snapshot([refreshedPacket]); fresh.sourceReport = value.sourceReport; fresh.reportHash = value.reportHash;
  await saveSnapshot(root, fresh); await importResult(root, fresh, modelResult(refreshedPacket));
  const crossSnapshot = await executePreview(root, config, 'diagnostic', async () => fresh, { now: clock });
  assert.equal(crossSnapshot.added, 0); assert.equal(crossSnapshot.reused, 2);
  const nextWindow = await executePreview(root, config, 'diagnostic', async () => fresh, { now: new Date('2026-09-25T00:00:00Z') });
  assert.equal(nextWindow.added, 1);
  const otherUser = await executePreview(root, { ...config, recipient: 'synthetic-other' }, 'diagnostic', async () => fresh, { now: clock });
  assert.equal(otherUser.added, 2);
  const formal = structuredClone(value); formal.purpose = 'formal';
  const mismatch = await executePreview(root, config, 'diagnostic', async () => formal, { now: clock });
  assert.equal(mismatch.status, 'failed'); assert.equal(mismatch.errorCode, 'PURPOSE_MISMATCH');
});

test('P5 已跟踪更正/终止不因缺关键词丢失；同名不同公告保留，旧版本不回退', async () => {
  const original = tender(); const { root, value, config } = await notifyFixture([original]);
  const first = await planEvents(root, value, config, [], clock);
  const changedNotice = structuredClone(original.notice); changedNotice.text += '\n变更'; changedNotice.version = 'b'.repeat(64); changedNotice.fetchedAt = '2026-09-24T10:00:00Z'; changedNotice.listing.title = '合成项目终止公告';
  const changed = makePacket(changedNotice, testRules, testPrompts, null, true);
  const updated = snapshot([changed]); updated.sourceReport = value.sourceReport; updated.reportHash = value.reportHash;
  const plan = await planEvents(root, updated, config, first.observations, clock);
  assert.equal(plan.events.filter(e => e.type === 'project-update').length, 1);
  assert.equal(plan.events.some(e => e.type === 'deadline'), false);
  const old = await planEvents(root, value, config, plan.observations, clock);
  assert.equal(old.events.some(e => ['deadline', 'related-notice', 'project-update'].includes(e.type)), false);
  assert.equal(old.observations.length, 0);
  const second = tender('notify-2'); const different = await notifyFixture([original, second]);
  const both = await planEvents(different.root, different.value, config, [], clock);
  assert.equal(both.events.filter(e => e.type === 'related-notice').length, 2);
});

test('P5 未分析只汇总缺口，条件延期/多个截止/开标时间不产生确定临期，结果公告不视作在招', async () => {
  const cases = ['开标时间：2026年09月25日18:00:00', '提交投标文件截止时间：2026年09月25日',
    '提交投标文件截止时间：2026年09月25日18:00:00，如不足三家自动顺延',
    '提交投标文件截止时间：2026年09月25日18:00:00\n响应文件提交截止：2026年09月26日18:00:00'];
  for (const body of cases) {
    const { root, value, config } = await notifyFixture([tender('ambiguous', body)]);
    const plan = await planEvents(root, value, config, [], clock);
    assert.equal(plan.events.some(e => e.type === 'deadline'), false); assert.ok(plan.events.some(e => e.type === 'review-required'));
  }
  const pending = await notifyFixture([tender()], false, false);
  const plan = await planEvents(pending.root, pending.value, pending.config, [], clock);
  assert.deepEqual(plan.events.map(e => e.type), ['review-required']);
  const result = makePacket(notice('result', '合成网站开发成交结果公告'), testRules, testPrompts, null);
  const fixture = await notifyFixture([result]);
  assert.equal((await planEvents(fixture.root, fixture.value, fixture.config, [], clock)).events.some(e => e.type === 'deadline'), false);
});

test('P5 查询失败/人工接管单列且脱敏；输入损坏有失败记录，零候选不是故障', async () => {
  const f = await notifyFixture([], true, false); const plan = await planEvents(f.root, f.value, f.config, [], clock);
  assert.equal(plan.events[0]?.type, 'run-problem'); assert.doesNotMatch(JSON.stringify(plan.events), /sensitive-fixture/);
  await writeFile(f.value.sourceReport, 'tampered');
  const failed = await executePreview(f.root, f.config, 'diagnostic', async () => f.value, { now: clock });
  assert.equal(failed.status, 'failed'); assert.equal(failed.errorCode, 'P1_SOURCE_HASH_MISMATCH');
  assert.equal((await loadLedger(f.root)).runs.length, 1);
  const zero = await notifyFixture([], false, false);
  const complete = await executePreview(zero.root, zero.config, 'diagnostic', async () => zero.value, { now: clock });
  assert.equal(complete.status, 'complete'); assert.equal(complete.added, 0);
});
