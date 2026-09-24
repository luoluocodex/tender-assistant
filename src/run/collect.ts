import { chromium } from 'playwright';
import type { Detail, Listing, QueryResult, RunConfig } from '../model.js';
import { collectCcgp, CCGP_REGIONS, readCcgpDetail } from '../sites/ccgp.js';
import { collectGuangdong } from '../sites/guangdong.js';
import { readGuangdongDetail } from '../sites/guangdong-content.js';
import { makeDetail, pageProblem, SiteAccessError } from '../sites/page.js';
import { RunContext } from './context.js';
import { createWindow } from './window.js';
import { listingKey } from './results.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 先覆盖各查询，再按公告类型选择并补足候选，避免样本集中于单一地区或模板。 */
export function chooseSamples(listings: Listing[], limit: number, priority: Listing[] = []): Listing[] {
  const unique = [...new Map(listings.map(item => [listingKey(item), item])).values()];
  const selected = new Map<string, Listing>();
  const types = new Set<string>();
  for (const item of priority) {
    if (selected.size >= limit) break;
    selected.set(listingKey(item), item);
    types.add(item.noticeType ?? 'unknown');
  }
  for (const item of unique) {
    if (selected.size >= limit) break;
    if (!types.has(item.noticeType ?? 'unknown')) { types.add(item.noticeType ?? 'unknown'); selected.set(listingKey(item), item); }
  }
  for (const item of unique) { if (selected.size >= limit) break; selected.set(listingKey(item), item); }
  return [...selected.values()];
}

/** 限流、禁止访问或等待人工的站点停止后续查询及详情；其他站点可以继续。 */
export function siteStopped(queries: QueryResult[], site: string): boolean {
  return queries.some(q => q.site === site && (q.status === 'needs-human' ||
    (typeof q.queryEvidence.accessFailure === 'object' && q.queryEvidence.accessFailure !== null && 'status' in q.queryEvidence.accessFailure && [403, 429].includes(Number(q.queryEvidence.accessFailure.status)))));
}

/** 有头、串行运行两站；异常保留报告，所有浏览器只由本次任务持有并清理。 */
export async function collect(config: RunConfig, purpose: 'formal' | 'diagnostic', site: string): Promise<{ directory: string; status: string; exitCode: number }> {
  const run = new RunContext(config, createWindow(new Date(), config.days), purpose);
  await run.initialize();
  const queries: QueryResult[] = [];
  const details: Detail[] = [];
  const errors: string[] = [];
  let browserVersion: string | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const startedAt = new Date().toISOString();
  let cancelled = false;
  const stop = (): void => { cancelled = true; run.cancelled = true; void browser?.close().catch(() => {}); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const deadline = setTimeout(stop, config.maxRunMinutes * 60000);
  try {
    browser = await chromium.launch({ headless: false });
    browserVersion = browser.version();
    await run.log('browser-started', { browser: browserVersion, headed: true, purpose });
    const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 960 }, acceptDownloads: false });
    context.setDefaultTimeout(config.actionTimeoutMs);
    context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    if (site !== 'guangdong') {
      for (const mode of purpose === 'formal' ? ['title', 'fulltext'] as const : ['fulltext'] as const) {
        for (const region of CCGP_REGIONS) {
          run.check();
          if (siteStopped(queries, 'ccgp')) break;
          queries.push(await collectCcgp(context, run, mode, region));
          await run.json('progress', { queries, details });
        }
      }
    }
    if (site !== 'ccgp') {
      run.check();
      queries.push(await collectGuangdong(context, run));
      await run.json('progress', { queries, details });
    }
    for (const source of config.sites) {
      if (siteStopped(queries, source.id)) { await run.log('site-stopped', { site_id: source.id, reason: 'access-limit-or-human-required' }); continue; }
      const sourceQueries = queries.filter(q => q.site === source.id);
      const candidates = sourceQueries.flatMap(q => q.listings);
      for (const listing of chooseSamples(candidates, config.maxDetailsPerSite, sourceQueries.flatMap(q => q.listings.slice(0, 1)))) {
        await run.pause();
        const page = await context.newPage();
        let detail: Detail;
        try {
          detail = source.id === 'ccgp' ? await readCcgpDetail(page, listing, run) : await readGuangdongDetail(page, listing, run);
        } catch (error) {
          const problem = page.isClosed() ? null : pageProblem(await page.title().catch(() => ''), await page.locator('body').innerText().catch(() => ''));
          detail = makeDetail(listing, null, '', false, problem ?? (error instanceof Error ? error.message.split('\n')[0]! : String(error)));
          detail.status = problem?.includes('人工') ? 'needs-human' : 'failed';
          if (error instanceof SiteAccessError && [403, 429].includes(error.status)) detail.status = 'needs-human';
          detail.sourceFiles = await run.evidence(page, `detail-error-${listing.id}`);
        } finally { await page.close(); }
        details.push(detail);
        await run.json(`detail-${source.id}-${listing.id.replace(/[^\w-]/g, '_')}`, detail);
        await run.json('progress', { queries, details });
        await run.log('detail-finished', { site_id: source.id, notice_id: listing.id, status: detail.status, characters: detail.text.length });
        if (detail.status === 'needs-human') break;
      }
    }
    await context.close();
  } catch (error) {
    errors.push(error instanceof Error ? error.message.split('\n')[0]! : String(error));
  } finally {
    clearTimeout(deadline);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await browser?.close().catch(() => {});
  }
  const selectedSites = config.sites.filter(s => site === 'both' || (site === 'ccgp' ? s.id === 'ccgp' : s.id !== 'ccgp'));
  const complete = errors.length === 0 && queries.length > 0 && queries.every(q => q.status === 'complete') && details.every(d => d.status === 'complete');
  const status = cancelled ? 'cancelled' : complete ? 'complete' : 'partial';
  const acceptance = selectedSites.map(s => ({
    site: s.id,
    searchToDetailCovered: queries.some(q => q.site === s.id && q.pages.length > 0) && details.some(d => d.listing.site === s.id && d.status === 'complete'),
    paginationCovered: queries.some(q => q.site === s.id && q.pages.length > 1),
    detailsChecked: details.filter(d => d.listing.site === s.id).length,
    detailsComplete: details.filter(d => d.listing.site === s.id && d.status === 'complete').length,
    notes: purpose === 'diagnostic' ? '诊断样本不替代正式业务验收' : '无结果导致的详情或分页缺口仍属未覆盖',
  }));
  const report = {
    schemaVersion: 1, phase: 'P1', purpose, status, startedAt, endedAt: new Date().toISOString(), window: run.window,
    keyword: config.keyword, queryDays: config.days, region: '广东省', headed: true, browserVersion,
    limits: { pages: config.maxPages, detailsPerSite: config.maxDetailsPerSite, minIntervalMs: config.minIntervalMs, maxRunMinutes: config.maxRunMinutes },
    notification: 'preview-only', queries, details, errors, acceptance,
    p1AcceptanceComplete: purpose === 'formal' && site === 'both' && complete && acceptance.every(x => x.searchToDetailCovered && x.paginationCovered),
    exactPhraseEvidence: details.map(d => ({ site: d.listing.site, id: d.listing.id, containsInTitle: d.listing.title.includes(config.keyword), containsInBody: d.text.includes(config.keyword), meaning: '仅短语出现检查，不是业务匹配结论' })),
  };
  await run.json('report', report);
  const preview = [
    '# P1 采集通知预览（未发送）', '', `用途：${purpose}；关键词：${config.keyword}；地区：广东省。`,
    `时间：${run.window.startDate} 至 ${run.window.endAt}（包含当天，Asia/Shanghai）。`, '',
    '| 查询 | 状态 | 已读页 | 候选数 | 原因 |', '|---|---|---:|---:|---|',
    ...queries.map(q => `| ${q.id} | ${q.status} | ${q.pages.length} | ${q.listings.length} | ${q.reason.replaceAll('|', '/')} |`),
    '', `已检查详情 ${details.length} 份，正文完整 ${details.filter(x => x.status === 'complete').length} 份。`,
    '候选来自站点搜索，尚未做业务相关性、资质判断或附件下载；诊断样本不能计入正式成果。',
    `P1 完整验收：${report.p1AcceptanceComplete ? '通过' : '未全部通过，查看 report.json 的 acceptance 与限制'}`, '',
  ].join('\n');
  await writeFile(join(run.directory, 'notification-preview.md'), preview, 'utf8');
  await run.log('run-finished', { status, queries: queries.length, details: details.length, p1_acceptance: report.p1AcceptanceComplete });
  return { directory: run.directory, status, exitCode: cancelled ? 130 : complete ? 0 : 2 };
}
