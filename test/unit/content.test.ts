import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readClosedContent } from '../../src/sites/guangdong-content.js';
import { confirmRendered } from '../../src/sites/guangdong.js';

test('从公告区域封闭 Shadow DOM 提取可见正文，排除页面外部封闭区域', async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section class="richtext"><div id="notice"></div></section></main><div id="unrelated"></div>');
    await page.evaluate(() => {
      const root = document.querySelector('#notice')!.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>p{color:black}</style><article><p>合成测试：项目编号 TEST-01</p><p>预算金额：100万元</p></article>';
      document.querySelector('#unrelated')!.attachShadow({ mode: 'closed' }).innerHTML = '<p>不应读取的无关区域</p>';
    });
    assert.equal(await page.locator('.richtext').innerText(), '');
    const extracted = await readClosedContent(page);
    assert.match(extracted.text, /项目编号 TEST-01/);
    assert.match(extracted.text, /预算金额：100万元/);
    assert(!extracted.text.includes('不应读取'));
    assert(!extracted.text.includes('color:black'));
    assert.match(extracted.html, /<article>/);
    await page.close();
  } finally { await browser.close(); }
});

test('列表采用完整标题提示校验，页面高亮摘要截断不造成漏采', async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h3 class="title"><span title="合成完整项目标题，包含后半段">合成完整项目<span>标题</span></span></h3></main>');
    await confirmRendered(page, ['合成完整项目标题，包含后半段']);
    await page.setContent('<main></main>');
    await confirmRendered(page, []);
  } finally { await browser.close(); }
});
