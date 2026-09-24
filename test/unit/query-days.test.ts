import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { loadConfig } from '../../src/run/config.js';
import { collect } from '../../src/run/collect.js';

async function fixture(days: unknown = 7) {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'query-days-'));
  await cp(resolve('config'), join(root, 'config'), { recursive: true });
  const baseline = {
    business: { keywords: ['合成日期测试'] }, region: { province: '广东省' },
    dateRange: { days, timezone: 'Asia/Shanghai', mode: 'calendar-days-including-today' },
    operation: { trigger: 'manual', externalSendingEnabled: false, recurringScheduleEnabled: false },
  };
  await writeFile(join(root, 'config/p0-baseline.json'), JSON.stringify(baseline));
  return root;
}

test('默认天数读取配置，本次参数覆盖默认值但不改写配置；重复调用不串范围', async () => {
  const root = await fixture(14);
  const baseline = join(root, 'config/p0-baseline.json'); const before = await readFile(baseline);
  assert.equal((await loadConfig(root)).days, 14);
  for (const days of ['3', '90', '1', '3']) assert.equal((await loadConfig(root, days)).days, Number(days));
  assert.equal((await loadConfig(root)).days, 14);
  assert.deepEqual(await readFile(baseline), before);
  for (const days of ['91', '100', '366']) await assert.rejects(loadConfig(root, days), /QUERY_DAYS_EXCEEDED.*90/);
  for (const days of ['0', '-1', '1.5', '', 'NaN', '1e1', '0x3', '三天']) await assert.rejects(loadConfig(root, days), /INVALID_QUERY_DAYS/);
});

test('默认配置也受 90 天限制，错误默认值不被运行参数掩盖', async () => {
  for (const days of [0, '7', 91]) {
    const root = await fixture(days);
    await assert.rejects(loadConfig(root), /QUERY_DAYS/);
    await assert.rejects(loadConfig(root, '3'), /QUERY_DAYS/);
  }
});

test('真实 CLI 传递天数且在初始化运行目录前拒绝超限；采集委派使用隔离替身', async () => {
  const root = await fixture();
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  for (const file of ['cli.js', 'run/config.js', 'run/window.js']) {
    const target = join(root, 'dist/src', file);
    await mkdir(resolve(target, '..'), { recursive: true }); await cp(resolve('dist/src', file), target);
  }
  await mkdir(join(root, 'dist/src/archive'), { recursive: true });
  await mkdir(join(root, 'dist/src/store'), { recursive: true });
  await writeFile(join(root, 'dist/src/archive/config.js'), `export async function archiveConfig() { return { runtimeRoot: ${JSON.stringify(join(root, 'synthetic-runtime'))} }; }`);
  await writeFile(join(root, 'dist/src/store/files.js'), `import { mkdir } from 'node:fs/promises';
export const initializeRoot = root => mkdir(root, { recursive: true });
export const acquireLock = async () => async () => {};`);
  await writeFile(join(root, 'dist/src/run/collect.js'), `import { createWindow } from './window.js';
export async function collect(config, purpose) { return { days: config.days, purpose, window: createWindow(new Date('2026-09-24T04:00:00Z'), config.days), exitCode: 0 }; }`);
  const run = (args: string[]) => spawnSync(process.execPath, [join(root, 'dist/src/cli.js'), ...args], { cwd: resolve(root, '..'), encoding: 'utf8', timeout: 15000 });
  for (const value of ['91', '100', '0', '-1', '1.5', '', '1e2']) {
    const result = run([`--days=${value}`]);
    assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /QUERY_DAYS.*90/);
    await assert.rejects(access(join(root, 'synthetic-runtime')));
  }
  const missing = run(['--days']); assert.equal(missing.status, 1);
  await assert.rejects(access(join(root, 'synthetic-runtime')));
  for (const [args, days, start, purpose] of [
    [[], 7, '2026-09-18', 'formal'],
    [['--days', '3'], 3, '2026-09-22', 'formal'],
    [['--days', '90'], 90, '2026-06-27', 'formal'],
    [['--days', '1', '--diagnostic', '--keyword', '合成'], 1, '2026-09-24', 'diagnostic'],
  ] as const) {
    const result = run([...args]); assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.days, days); assert.equal(output.window.startDate, start); assert.equal(output.purpose, purpose);
  }
});

test('真实采集流程把 3 / 90 天传入全国站请求、报告和零结果；所有网络由本地合成页面拦截', async () => {
  const originalLaunch = chromium.launch.bind(chromium);
  const requested: URL[] = [];
  const launch = mock.method(chromium, 'launch', async () => {
    const browser = await originalLaunch({ headless: false });
    const originalContext = browser.newContext.bind(browser);
    mock.method(browser, 'newContext', async () => {
      const context = await originalContext();
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'search.ccgp.gov.cn' || url.pathname !== '/bxsearch') { await route.abort(); return; }
        requested.push(url);
        const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        const inputs = [...url.searchParams].map(([key, value]) => `<input id="${escape(key)}" value="${escape(value)}">`).join('');
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>合成零结果</title>${inputs}<p>共找到 0 条内容</p><ul class="vT-srch-result-list-bid"></ul>` });
      });
      return context;
    });
    return browser;
  });
  try {
    for (const days of [3, 90]) {
      const root = await fixture(); const config = await loadConfig(root, String(days));
      config.minIntervalMs = 1;
      const offset = requested.length;
      const result = await collect(config, 'formal', 'ccgp');
      assert.equal(result.exitCode, 0);
      const report = JSON.parse(await readFile(join(result.directory, 'report.json'), 'utf8'));
      assert.equal(report.queryDays, days);
      assert.equal((Date.parse(report.window.endDate) - Date.parse(report.window.startDate)) / 86400000 + 1, days);
      assert.equal(requested.length - offset, 4);
      for (const url of requested.slice(offset)) {
        assert.equal(url.searchParams.get('start_time'), report.window.startDate.replaceAll('-', ':'));
        assert.equal(url.searchParams.get('end_time'), report.window.endDate.replaceAll('-', ':'));
      }
      assert.equal(report.queries.length, 4);
      for (const query of report.queries) {
        assert.deepEqual(query.window, report.window); assert.equal(query.totalReported, 0); assert.equal(query.status, 'complete');
      }
      assert.equal(report.p1AcceptanceComplete, false);
    }
  } finally { launch.mock.restore(); }
});
