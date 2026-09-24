/** 仅接受明确到分钟的北京时间；不将日期缺失、截止类型不明或条件延期补成精确时间。 */
export function deadlineInstant(raw: string): number | null {
  const m = /^(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})\s+(\d{1,2})(?::|时)(\d{2})(?:分)?(?:(?::|\s*)(\d{2})秒?)?$/.exec(raw.trim().replace('日', ' '));
  if (!m) return null;
  const [y, month, d, h, min, sec] = m.slice(1).map(v => Number(v ?? 0));
  if (month! < 1 || month! > 12 || d! < 1 || h! > 23 || min! > 59 || sec! > 59) return null;
  const local = new Date(Date.UTC(y!, month! - 1, d!, h!, min!, sec!));
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== month! - 1 || local.getUTCDate() !== d) return null;
  return local.getTime() - 8 * 3600000;
}

/** 每个临期窗口只产生一次事件；过期时间不生成“即将截止”的通知。 */
export function deadlineBucket(at: number, now: number, hours: number[]): number | null {
  if (at <= now) return null;
  return [...hours].sort((a, b) => a - b).find(h => at - now <= h * 3600000) ?? null;
}
