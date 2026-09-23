import type { BrowserContext, Page } from 'playwright';
import type { Detail, Listing, QueryResult } from '../model.js';
import type { RunContext } from '../run/context.js';
import { addListings, finishQuery, pageSignature } from '../run/results.js';
import { makeDetail, navigate, pageProblem, SiteAccessError } from './page.js';

/** 地区值来自 2026-09-23 页面选项；广东选项明确不包含深圳。 */
export const CCGP_REGIONS = [{ label: '广东', value: '44 not 4403' }, { label: '深圳', value: '4403' }] as const;

/** 深圳查询的列表仍可能显示省级“广东”；查询区域另由表单 zoneId 校验。 */
export function matchesCcgpRegion(displayed: string | null, selected: string): boolean {
  return selected === '深圳' ? displayed === '广东' || displayed === '深圳' : displayed === '广东';
}

/** 公开搜索 URL 与字段来自页面实际提交，不调用未验证的私有接口。 */
export function ccgpSearchUrl(keyword: string, start: string, end: string, region: typeof CCGP_REGIONS[number], mode: 'title' | 'fulltext'): string {
  const params = new URLSearchParams({
    searchtype: mode === 'title' ? '1' : '2', page_index: '1', bidSort: '0', buyerName: '', projectId: '',
    pinMu: '0', bidType: '0', dbselect: 'bidx', kw: keyword,
    start_time: start.replaceAll('-', ':'), end_time: end.replaceAll('-', ':'), timeType: '6',
    displayZone: region.label, zoneId: region.value, pppStatus: '0', agentName: '',
  });
  return `http://search.ccgp.gov.cn/bxsearch?${params}`;
}

/** 把页面列表文本映射为候选，保留公告类型和原文，不推断资格。 */
export function parseCcgpListing(title: string, url: string, text: string): Listing {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const meta = lines.find(line => /\d{4}\.\d{2}\.\d{2}/.test(line)) ?? '';
  const footer = lines.at(-1)?.split('|').map(x => x.trim()) ?? [];
  const date = meta.match(/\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}/)?.[0].replaceAll('.', '-') ?? null;
  return { site: 'ccgp', id: url.match(/_(\d+)\.htm/)?.[1] ?? url, title: title.trim(), url, publishedAt: date, region: footer[1] ?? null, noticeType: footer[0] ?? null, evidence: text };
}

async function readList(page: Page): Promise<Listing[]> {
  const rows = await page.locator('.vT-srch-result-list-bid > li').evaluateAll(elements => elements.map(li => {
    const link = li.querySelector('a');
    return { title: link?.textContent ?? '', url: link?.href ?? '', text: (li as HTMLElement).innerText };
  }));
  if (rows.some(row => !row.title.trim() || !/^https?:\/\/www\.ccgp\.gov\.cn\/cggg\//.test(row.url))) throw new Error('列表结构或详情来源发生变化');
  return rows.map(row => parseCcgpListing(row.title, row.url, row.text));
}

/** 查询独立保存结果，零结果、部分完成和拦截状态互不混用。 */
export async function collectCcgp(context: BrowserContext, run: RunContext, mode: 'title' | 'fulltext', region: typeof CCGP_REGIONS[number]): Promise<QueryResult> {
  const result: QueryResult = {
    id: `ccgp-${region.value.startsWith('4403') ? 'shenzhen' : 'guangdong'}-${mode}`, site: 'ccgp', keyword: run.config.keyword,
    region: region.label, mode, window: run.window, status: 'running', reason: '', totalReported: null,
    pages: [], listings: [], duplicates: 0, excluded: [], needsReview: [], queryEvidence: {},
  };
  const page = await context.newPage();
  try {
    await run.pause();
    await navigate(page, ccgpSearchUrl(result.keyword, run.window.startDate, run.window.endDate, region, mode));
    let reachedEnd = false;
    for (let number = 1; number <= run.config.maxPages; number++) {
      run.check();
      await page.locator('#kw').waitFor();
      const problem = pageProblem(await page.title(), await page.locator('body').innerText());
      if (problem) throw new Error(problem);
      const state = await page.locator('input[id]').evaluateAll(es => Object.fromEntries(es.map(e => [(e as HTMLInputElement).id, (e as HTMLInputElement).value])));
      if (state.kw !== result.keyword || state.zoneId !== region.value || state.timeType !== '6' ||
        state.start_time !== run.window.startDate.replaceAll('-', ':') || state.end_time !== run.window.endDate.replaceAll('-', ':') ||
        state.searchtype !== (mode === 'title' ? '1' : '2') || state.page_index !== String(number)) throw new Error('页面回显查询条件不一致');
      const body = await page.locator('body').innerText();
      const total = body.match(/共找到\s*([\d,]+)\s*条内容/);
      if (!total) throw new Error('缺少搜索结果总数，不能判断零结果');
      const count = Number(total[1]!.replaceAll(',', ''));
      if (result.totalReported !== null && result.totalReported !== count) result.queryEvidence.totalChangedDuringRun = true;
      result.totalReported = count;
      result.queryEvidence = { ...result.queryEvidence, url: page.url(), keyword: state.kw, startDate: state.start_time, endDate: state.end_time, region: state.displayZone, zoneId: state.zoneId, searchtype: state.searchtype };
      const items = await readList(page);
      if (items.some(item => !matchesCcgpRegion(item.region, region.label))) throw new Error('列表地区与查询地区不一致');
      if (!items.length && count !== 0) throw new Error('站点报告非零结果，但列表为空');
      const signature = pageSignature(items);
      if (items.length && result.pages.some(x => x.signature === signature)) throw new Error('翻页返回重复列表');
      result.pages.push({ number, count: items.length, signature, evidence: await run.evidence(page, `${result.id}-page-${number}`) });
      addListings(result, items);
      await run.json(result.id, result);
      await run.log('query-page', { query_id: result.id, page: number, count: items.length, total: count });
      const next = page.getByRole('link', { name: '下一页', exact: true }).first();
      if (count === 0 || await next.count() === 0) { reachedEnd = true; break; }
      if (number === run.config.maxPages) break;
      await run.pause();
      // 站点使用 javascript:void(0) + 表单提交，必须实际点击，不能把 href 当 URL 导航。
      const [navigationResponse] = await Promise.all([
        page.waitForResponse(response => response.request().isNavigationRequest() && response.frame() === page.mainFrame() &&
          new URL(response.url()).searchParams.get('page_index') === String(number + 1)),
        Promise.all([page.waitForURL(url => url.searchParams.get('page_index') === String(number + 1), { waitUntil: 'domcontentloaded' }), next.click()]),
      ]);
      if (navigationResponse.status() >= 400) throw new SiteAccessError(navigationResponse.status(), navigationResponse.headers()['retry-after'] ?? null);
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

/** 读取经列表确认的中国政府采购网公告，附件仅登记公开链接。 */
export async function readCcgpDetail(page: Page, listing: Listing, run: RunContext): Promise<Detail> {
  if (new URL(listing.url).hostname !== 'www.ccgp.gov.cn') throw new Error('详情来源不匹配');
  await navigate(page, listing.url);
  await page.locator('.vF_detail_content').waitFor();
  const title = (await page.locator('.vF_detail_header h2').innerText()).trim();
  const text = await page.locator('.vF_detail_content').innerText();
  const problem = pageProblem(await page.title(), text);
  if (problem) throw new Error(problem);
  const complete = title.length > 0 && text.length > 150 && /项目|采购|合同|更正/.test(text) && /联系|附件|公告期限|采购人|采购单位/.test(text);
  const detail = makeDetail(listing, title, text, complete, complete ? '已提取公告正文；附件尚未下载' : '正文缺少预期内容，需复核');
  detail.attachments = await page.locator('.vF_detail_content a[href]').evaluateAll(es => es.map(e => ({ name: e.textContent?.trim() ?? '', url: (e as HTMLAnchorElement).href, status: 'not-downloaded' as const })).filter(x => /\.(pdf|docx?|xlsx?|zip|rar)(?:\?|$)/i.test(x.url) || /download/i.test(x.url)));
  detail.sourceFiles = await run.evidence(page, `ccgp-detail-${listing.id}`);
  return detail;
}
