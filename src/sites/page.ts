import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import type { Detail, Listing } from '../model.js';
import { extractFields } from './fields.js';

/** 记录 HTTP 访问边界和服务端退避提示；不自动切换身份或重复撞限流。 */
export class SiteAccessError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null = null) {
    super(`站点 HTTP ${status}${status === 429 ? '：访问限流，停止该站后续请求' : ''}`);
  }
}

/** 只检查拦截页特征；公告中提及“验证码”不视为整页认证失败。 */
export function pageProblem(title: string, text: string): string | null {
  if (/频繁访问|访问过于频繁|Access Denied|访问被拒绝/i.test(`${title}\n${text.slice(0,800)}`)) return '访问受限或限流，需要稍后人工检查';
  if (text.length < 2500 && /安全验证|请完成验证|请输入验证码|请先登录|登录后继续|人机验证/.test(text)) return '需要人工完成登录或验证';
  if (/^\s*(?:404|502|503|504|系统异常|服务异常)/.test(text)) return '站点错误页';
  return null;
}

/** 导航失败保留明确错误，不把非成功状态当作公告。 */
export async function navigate(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (response && response.status() >= 400) throw new SiteAccessError(response.status(), response.headers()['retry-after'] ?? null);
}

/** 统一详情输出，缺失正文不会产生“完整”结论。 */
export function makeDetail(listing: Listing, title: string | null, text: string, complete: boolean, reason: string): Detail {
  return {
    listing, title, text, status: complete ? 'complete' : 'partial', reason,
    fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex'),
    fields: extractFields(text), attachments: [], sourceFiles: [],
  };
}
