import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindow, checkPublication } from '../../src/run/window.js';

test('7 个自然日包含当天，独立于系统时区并可跨年', () => {
  const window = createWindow(new Date('2026-12-31T16:30:00Z'));
  assert.equal(window.startDate, '2026-12-26');
  assert.equal(window.endDate, '2027-01-01');
  assert.equal(window.startAt, '2026-12-26T00:00:00+08:00');
});

test('起点包含、截止时刻固定，当天缺少时分秒保留复核', () => {
  const window = createWindow(new Date('2026-09-23T09:00:00Z'));
  assert.equal(window.startDate, '2026-09-17');
  for (const value of ['2026-09-17 00:00:00', '2026年09月23日 17:00:00']) assert.equal(checkPublication(value, window), 'inside');
  for (const value of ['2026-09-16 23:59:59', '2026-09-23 17:00:01', '2026-09-24']) assert.equal(checkPublication(value, window), 'outside');
  assert.equal(checkPublication('2026-09-23', window), 'review');
  assert.equal(checkPublication('2026-09-22', window), 'inside');
});

test('缺失或非法日期不变成零值或自动排除', () => {
  const window = createWindow(new Date('2026-03-02T00:00:00Z'));
  for (const value of [null, '', '2026-02-30', '2026-02-28 26:00:00', '日期待定']) assert.equal(checkPublication(value, window), 'review');
  assert.throws(() => createWindow(new Date('invalid')));
  assert.throws(() => createWindow(new Date(), 0));
});
