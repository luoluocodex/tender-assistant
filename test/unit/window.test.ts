import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindow, checkPublication, validateQueryDays } from '../../src/run/window.js';

test('7 个自然日包含当天，独立于系统时区并可跨年', () => {
  const window = createWindow(new Date('2026-12-31T16:30:00Z'), 7);
  assert.equal(window.startDate, '2026-12-26');
  assert.equal(window.endDate, '2027-01-01');
  assert.equal(window.startAt, '2026-12-26T00:00:00+08:00');
});

test('起点包含、截止时刻固定，当天缺少时分秒保留复核', () => {
  const window = createWindow(new Date('2026-09-23T09:00:00Z'), 7);
  assert.equal(window.startDate, '2026-09-17');
  for (const value of ['2026-09-17 00:00:00', '2026年09月23日 17:00:00']) assert.equal(checkPublication(value, window), 'inside');
  for (const value of ['2026-09-16 23:59:59', '2026-09-23 17:00:01', '2026-09-24']) assert.equal(checkPublication(value, window), 'outside');
  assert.equal(checkPublication('2026-09-23', window), 'review');
  assert.equal(checkPublication('2026-09-22', window), 'inside');
});

test('缺失或非法日期不变成零值或自动排除', () => {
  const window = createWindow(new Date('2026-03-02T00:00:00Z'), 7);
  for (const value of [null, '', '2026-02-30', '2026-02-28 26:00:00', '日期待定']) assert.equal(checkPublication(value, window), 'review');
  assert.throws(() => createWindow(new Date('invalid'), 7));
  assert.throws(() => createWindow(new Date(), 0));
});

test('按指定天数取窗口，覆盖当天、三天、90 天、闰年与北京时间日界', () => {
  const now = new Date('2026-09-24T04:00:00Z');
  for (const [days, start] of [[1, '2026-09-24'], [3, '2026-09-22'], [90, '2026-06-27']] as const) {
    const window = createWindow(now, days);
    assert.equal(window.startDate, start);
    assert.equal(window.endDate, '2026-09-24');
    assert.equal(window.endAt, now.toISOString());
    assert.equal(checkPublication(`${start} 00:00:00`, window), 'inside');
    assert.equal(checkPublication('2026-09-24 12:00:01', window), 'outside');
  }
  assert.equal(createWindow(new Date('2024-03-01T01:00:00Z'), 3).startDate, '2024-02-28');
  assert.equal(createWindow(new Date('2026-12-31T15:59:59Z'), 1).endDate, '2026-12-31');
  assert.equal(createWindow(new Date('2026-12-31T16:00:00Z'), 1).endDate, '2027-01-01');
});

test('非法天数和超过 90 天明确拒绝，不能通过直接调用窗口函数绕过', () => {
  for (const days of [91, 366, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createWindow(new Date(), days), /QUERY_DAYS_EXCEEDED.*90/);
  }
  for (const days of [undefined, null, '3', 0, -1, 1.5, NaN]) {
    assert.throws(() => validateQueryDays(days), /INVALID_QUERY_DAYS.*1～90/);
  }
});
