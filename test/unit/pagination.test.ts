import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { RunConfig } from '../../src/model.js';
import { RunContext } from '../../src/run/context.js';
import { createWindow } from '../../src/run/window.js';
import { siteStopped } from '../../src/run/collect.js';
import { collectCcgp, CCGP_REGIONS } from '../../src/sites/ccgp.js';

test('脚本提交的下一页可到达末页；翻页 HTTP 429 保留已有结果并停止该站', async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    for (const status of [200, 429]) {
      const context = await browser.newContext();
      context.setDefaultTimeout(3000);
      const requests: string[] = [];
      // 所有请求在本地拦截并返回合成 HTML，不访问政府站点。
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'search.ccgp.gov.cn' || url.pathname !== '/bxsearch') { await route.abort(); return; }
        const number = url.searchParams.get('page_index')!;
        requests.push(number);
        if (number === '2' && status === 429) {
          await route.fulfill({ status: 429, contentType: 'text/html; charset=utf-8', headers: { 'retry-after': '120' }, body: '<title>合成限流页</title><p>合成 HTTP 429</p>' });
          return;
        }
        const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        const inputs = [...url.searchParams].map(([id, value]) => `<input id="${escape(id)}" value="${escape(value)}">`).join('');
        const next = number === '1' ? `<a href="javascript:void(0)" onclick="const u=new window.URL(window.location.href);u.searchParams.set('page_index','2');window.location.href=u.href">下一页</a>` : '';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>合成分页测试</title>${inputs}<p>共找到 2 条内容</p><ul class="vT-srch-result-list-bid"><li><a href="https://www.ccgp.gov.cn/cggg/test_${number}.htm">合成公告 ${number}</a><p>2026.09.20 10:00:00</p><p>公开招标公告 | 广东</p></li></ul>${next}` });
      });
      const config: RunConfig = {
        outputDir: resolve('output/playwright/tests'), headless: false, maxPages: 3, maxDetailsPerSite: 1,
        minIntervalMs: 1, navigationTimeoutMs: 3000, actionTimeoutMs: 3000, maxRunMinutes: 1,
        keyword: '合成分页测试', sites: [{ id: 'ccgp', entryUrl: 'https://www.ccgp.gov.cn/' }],
      };
      const run = new RunContext(config, createWindow(new Date('2026-09-23T09:00:00Z')), 'diagnostic');
      await run.initialize();
      const result = await collectCcgp(context, run, 'fulltext', CCGP_REGIONS[0]);
      assert.deepEqual(requests, ['1', '2']);
      assert.equal(result.pages.length, status === 200 ? 2 : 1);
      assert.equal(result.listings.length, status === 200 ? 2 : 1);
      assert.equal(result.status, status === 200 ? 'complete' : 'partial');
      assert.equal(siteStopped([result], 'ccgp'), status === 429);
      if (status === 429) assert.deepEqual(result.queryEvidence.accessFailure, { status: 429, retryAfter: '120' });
      await context.close();
    }
  } finally { await browser.close(); }
});
