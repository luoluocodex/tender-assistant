import { createHash } from 'node:crypto';
import type { Listing, QueryResult } from '../model.js';
import { checkPublication } from './window.js';

/** 来源内按公告标识去重，保留各站转载，不以标题合并项目。 */
export function listingKey(item: Listing): string {
  return `${item.site}:${item.id || item.url}`;
}

/** 页面签名用于识别翻页重复，不把重复页面当成翻页成功。 */
export function pageSignature(items: Listing[]): string {
  return createHash('sha256').update(items.map(listingKey).join('\n')).digest('hex');
}

/** 在查询已验证地区的前提下复核日期；缺失值保留待核验。 */
export function addListings(result: QueryResult, items: Listing[]): void {
  const seen = new Set([...result.listings, ...result.excluded.map(x => x.listing)].map(listingKey));
  for (const item of items) {
    const key = listingKey(item);
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);
    const date = checkPublication(item.publishedAt, result.window);
    if (date === 'outside') result.excluded.push({ listing: item, reason: '发布时间超出固定窗口' });
    else {
      result.listings.push(item);
      if (date === 'review') result.needsReview.push({ listing: item, reason: '发布日期缺失、无效或只有当天日期，需复核精确时间' });
    }
  }
}

/** 必须有明确总数或终页依据；达到预算上限保持部分完成。 */
export function finishQuery(result: QueryResult, reachedEnd: boolean): void {
  const observed = result.listings.length + result.excluded.length;
  if (!reachedEnd) { result.status = 'partial'; result.reason = '达到页数上限，尚未验证终页'; return; }
  if (result.totalReported !== null && observed < result.totalReported) {
    result.status = 'partial'; result.reason = `列表覆盖不足：去重后 ${observed} / 页面报告 ${result.totalReported}`;
  } else {
    result.status = 'complete'; result.reason = observed === 0 ? '页面明确返回零结果' : '已验证末页';
  }
}
