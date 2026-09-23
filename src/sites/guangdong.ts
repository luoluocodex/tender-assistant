import type { BrowserContext, Page, Response } from 'playwright';
import type { Listing, QueryResult } from '../model.js';
import type { RunContext } from '../run/context.js';
import { addListings, finishQuery, pageSignature } from '../run/results.js';
import { navigate, pageProblem, SiteAccessError } from './page.js';

const SEARCH_PATH = '/ggzy-portal/search/v2/items';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('广东站响应结构变化');
  return value as Record<string, unknown>;
}
function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** 依据已观察的 v3 A/D/R 路由与列表字段构造来源链接；未知模板拒绝伪造。 */
export function guangdongListing(value: unknown, searchUrl: string): Listing {
  const row = record(value);
  const id = str(row.noticeId);
  const title = str(row.noticeTitle);
  if (!id || !title || !str(row.regionCode).startsWith('44')) throw new Error('广东候选缺少标识、标题或地区不符');
  const type = str(row.noticeSecondType);
  const params = new URLSearchParams({
    noticeId: id, projectCode: str(row.projectCode), bizCode: str(row.tradingProcess),
    siteCode: str(row.regionCode), publishDate: str(row.publishDate), source: str(row.pubServicePlat),
    titleDetails: str(row.noticeSecondTypeDesc), classify: str(row.projectType),
  });
  const url = row.edition === 'v3' && ['A', 'D', 'R'].includes(type)
    ? `https://ygp.gdzwfw.gov.cn/#/44/new/jygg/v3/${type}?${params}` : searchUrl;
  const rawDate = str(row.publishDate);
  const date = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(rawDate);
  return {
    site: 'guangdong-public-resources', id, title, url,
    publishedAt: date ? `${date[1]}-${date[2]}-${date[3]} ${date[4]}:${date[5]}:${date[6]}` : null,
    region: str(row.regionName) || null, noticeType: str(row.noticeThirdTypeDesc) || str(row.datasetName) || null,
    evidence: JSON.stringify(row),
  };
}

async function chooseDate(page: Page, label: string, date: string): Promise<void> {
  const holder = page.getByText(new RegExp(label)).filter({ visible: true }).locator('.gd-datepicker');
  await holder.locator('.input-wrapper').click();
  const panel = holder.locator('.date-panel:visible');
  const [year, month, day] = date.split('-').map(Number);
  const desired = year! * 12 + month!;
  for (let step = 0; step < 13; step++) {
    const value = (await panel.locator('.month-box').innerText()).match(/(\d+)年(\d+)月/);
    if (!value) throw new Error('无法读取日期选择器月份');
    const current = Number(value[1]) * 12 + Number(value[2]);
    if (current === desired) {
      await panel.locator('.date-list li:not(.preMonth):not(.nextMonth)').filter({ hasText: new RegExp(`^${day}$`) }).click();
      return;
    }
    await panel.locator(`.panel-header:visible .${current > desired ? 'arrow-left' : 'arrow-right'}`).click();
  }
  throw new Error('日期选择超出已验证月份范围');
}

async function submit(page: Page, action: () => Promise<unknown>, expectedPage: number, start: string, end: string): Promise<Response> {
  const response = page.waitForResponse(r => {
    if (new URL(r.url()).pathname !== SEARCH_PATH) return false;
    const request = record(r.request().postDataJSON());
    return request.pageNo === expectedPage && request.publishStartTime === start && request.publishEndTime === end;
  }, { timeout: 45000 });
  const [result] = await Promise.all([response, action()]);
  if (!result.ok()) throw new SiteAccessError(result.status(), result.headers()['retry-after'] ?? null);
  return result;
}

/** 高亮摘要可能截短标题，使用页面 title 提示核对完整标题并等待整页一致。 */
export async function confirmRendered(page: Page, titles: string[]): Promise<void> {
  await page.waitForFunction(expected => {
    const normalize = (value: string): string => value.normalize('NFKC').replace(/\s+/g, '');
    const actual = [...document.querySelectorAll('main h3.title')].map(e => e.querySelector('[title]')?.getAttribute('title') ?? e.textContent ?? '');
    return actual.length === expected.length && expected.every((title, i) => normalize(actual[i] ?? '') === normalize(title));
  }, titles);
}

/** 浏览器操作筛选和翻页，读取同一页面真实响应，校验请求、响应和可见标题。 */
export async function collectGuangdong(context: BrowserContext, run: RunContext): Promise<QueryResult> {
  const result: QueryResult = {
    id: 'guangdong-site-default', site: 'guangdong-public-resources', keyword: run.config.keyword, region: '广东省',
    mode: 'site-default', window: run.window, status: 'running', reason: '', totalReported: null,
    pages: [], listings: [], duplicates: 0, excluded: [], needsReview: [], queryEvidence: { semantics: '站点分词检索，候选不等于精确短语匹配' },
  };
  const page = await context.newPage();
  try {
    await run.pause();
    await navigate(page, `https://ygp.gdzwfw.gov.cn/#/44/search/jygg?keywords=${encodeURIComponent(result.keyword)}`);
    await page.getByRole('textbox', { name: '请输入关键字搜索' }).waitFor();
    await page.getByTitle('最近1年', { exact: true }).waitFor();
    await page.getByTitle('最近1年', { exact: true }).click();
    await page.getByText('自定义', { exact: true }).filter({ visible: true }).click();
    await chooseDate(page, '开始日期', run.window.startDate);
    await chooseDate(page, '结束日期', run.window.endDate);
    await run.pause();
    const start = `${run.window.startDate.replaceAll('-', '')}000000`;
    const end = `${run.window.endDate.replaceAll('-', '')}235959`;
    let response = await submit(page, () => page.getByRole('button', { name: '确认', exact: true }).filter({ visible: true }).click(), 1, start, end);
    let reachedEnd = false;
    for (let number = 1; number <= run.config.maxPages; number++) {
      run.check();
      const request = record(response.request().postDataJSON());
      result.queryEvidence.lastObservedRequest = request;
      if (request.keyword !== result.keyword || request.siteCode !== '44' || request.publishStartTime !== start || request.publishEndTime !== end || request.pageNo !== number) throw new Error('广东站实际提交的筛选条件不一致');
      const body: unknown = await response.json();
      const envelope = record(body);
      if (envelope.errcode !== 0) throw new Error('广东站返回业务错误');
      const data = record(envelope.data);
      const dataEvidence = await run.json(`${result.id}-response-${number}`, { request, response: body });
      if (data.pageNo !== number || !Array.isArray(data.pageData)) throw new Error('广东站页码或列表结构异常');
      const total = Number(data.total);
      const pages = Number(data.pageTotal);
      if (!Number.isInteger(total) || total < 0 || !Number.isInteger(pages) || pages < 0) throw new Error('广东站缺少有效分页总数');
      const items = data.pageData.map(item => guangdongListing(item, page.url()));
      if (total > 0 && !items.length) throw new Error('非零查询返回空列表');
      await confirmRendered(page, items.map(x => x.title));
      if (result.totalReported !== null && result.totalReported !== total) result.queryEvidence.totalChangedDuringRun = true;
      result.totalReported = total;
      result.queryEvidence = { ...result.queryEvidence, url: page.url(), request, totalPages: pages, transport: '浏览器实际搜索响应；未独立重放 HTTP' };
      const signature = pageSignature(items);
      if (items.length && result.pages.some(x => x.signature === signature)) throw new Error('翻页返回重复列表');
      result.pages.push({ number, count: items.length, signature, evidence: [dataEvidence, ...await run.evidence(page, `${result.id}-page-${number}`)] });
      addListings(result, items);
      for (const item of items.filter(x => !x.url.includes('/new/jygg/'))) result.needsReview.push({ listing: item, reason: '详情路由模板尚未验证，保留原始检索来源' });
      await run.json(result.id, result);
      await run.log('query-page', { query_id: result.id, page: number, count: items.length, total });
      if (total === 0 || number >= pages) { reachedEnd = true; break; }
      if (number === run.config.maxPages) break;
      await run.pause();
      await page.getByRole('spinbutton').fill(String(number + 1));
      response = await submit(page, () => page.getByRole('button', { name: '跳转', exact: true }).click(), number + 1, start, end);
    }
    finishQuery(result, reachedEnd);
    if (result.queryEvidence.totalChangedDuringRun) { result.status = 'partial'; result.reason = '检索期间总数发生变化，需要重叠复核'; }
  } catch (error) {
    if (error instanceof SiteAccessError) result.queryEvidence.accessFailure = { status: error.status, retryAfter: error.retryAfter };
    const problem = page.isClosed() ? null : pageProblem(await page.title().catch(() => ''), await page.locator('body').innerText().catch(() => ''));
    result.status = problem?.includes('人工') ? 'needs-human' : result.pages.length ? 'partial' : 'failed';
    result.reason = problem ?? (error instanceof Error ? error.message.split('\n')[0]! : String(error));
    await run.evidence(page, `${result.id}-error`);
  } finally {
    await run.json(result.id, result);
    await page.close();
  }
  return result;
}
