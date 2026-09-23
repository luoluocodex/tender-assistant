import type { QueryWindow } from '../model.js';

const DAY = 86_400_000;

/** 最近 days 个自然日包含今天；避免操作系统时区影响查询边界。 */
export function createWindow(now = new Date(), days = 7): QueryWindow {
  if (!Number.isInteger(days) || days < 1 || days > 366 || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid date window');
  }
  const endDate = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(`${endDate}T00:00:00+08:00`) - (days - 1) * DAY + 8 * 3_600_000)
    .toISOString().slice(0, 10);
  return { startDate, endDate, startAt: `${startDate}T00:00:00+08:00`, endAt: now.toISOString(), timezone: 'Asia/Shanghai' };
}

/** 按发布日期复核；只有日期时无法判定当天的精确截止时刻。 */
export function checkPublication(raw: string | null, window: QueryWindow): 'inside' | 'outside' | 'review' {
  if (!raw) return 'review';
  const normalized = raw.replace(/年|月/g, '-').replace(/日/g, '').trim();
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return 'review';
  const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
  const dateCheck = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== date) return 'review';
  if (date < window.startDate || date > window.endDate) return 'outside';
  if (!match[4]) return date === window.endDate ? 'review' : 'inside';
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59) return 'review';
  const time = Date.parse(`${date}T${match[4].padStart(2, '0')}:${match[5]}:${match[6] ?? '00'}+08:00`);
  return time >= Date.parse(window.startAt) && time <= Date.parse(window.endAt) ? 'inside' : 'outside';
}
