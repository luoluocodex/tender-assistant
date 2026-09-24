import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccgpSearchUrl, CCGP_REGIONS, parseCcgpListing, matchesCcgpRegion } from '../../src/sites/ccgp.js';
import { guangdongListing } from '../../src/sites/guangdong.js';
import { extractFields } from '../../src/sites/fields.js';
import { pageProblem } from '../../src/sites/page.js';

test('广东和深圳必须分别查询，显式日期不使用默认近一周', () => {
  const urls = CCGP_REGIONS.map(region => new URL(ccgpSearchUrl('网站开发', '2026-09-17', '2026-09-23', region, 'fulltext')));
  assert.deepEqual(urls.map(x => x.searchParams.get('zoneId')), ['44 not 4403', '4403']);
  assert.equal(urls[0]!.searchParams.get('start_time'), '2026:09:17');
  assert.equal(urls[0]!.searchParams.get('timeType'), '6');
  assert.equal(urls[0]!.searchParams.get('kw'), '网站开发');
});

test('全国站列表解析日期、类型和地区，缺失发布日期不补造', () => {
  const row = parseCcgpListing(' 合成公告 ', 'http://www.ccgp.gov.cn/cggg/dfgg/gkzb/202609/t20260923_123.htm', '合成公告\n测试片段\n2026.09.23 17:03:23 | 采购人：合成单位\n公开招标公告 | 广东 |');
  assert.equal(row.publishedAt, '2026-09-23 17:03:23');
  assert.equal(row.noticeType, '公开招标公告');
  assert.equal(row.region, '广东');
  assert.equal(row.id, '123');
  assert.equal(parseCcgpListing('测试', 'https://example.invalid', '').publishedAt, null);
  assert.equal(matchesCcgpRegion('广东', '深圳'), true);
  assert.equal(matchesCcgpRegion('北京', '深圳'), false);
});

test('项目概况的投标截止不误记成文件获取日期，保留完整日期区间和整点', () => {
  const fields = extractFields('潜在投标人应获取招标文件，并于2026年10月19日09时30分前投标。\n三、获取招标文件\n时间：2026年09月23日 至 2026年10月08日\n地点：合成测试地点\n截止时间：2026年9月29日16时');
  const windows = fields.dates.filter(x => x.kind === 'document-window');
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.raw, '2026年09月23日 至 2026年10月08日');
  assert(fields.dates.some(x => x.raw === '2026年9月29日16时'));
});

test('广东列表校验地区，未知详情模板不编造链接', () => {
  const raw = { noticeId: 'synthetic', noticeTitle: '合成样本', regionCode: '440100', regionName: '广州市', publishDate: '20260923123456', noticeSecondType: 'D', edition: 'v3', tradingProcess: '3871', projectCode: 'TEST', noticeThirdTypeDesc: '结果公告' };
  const item = guangdongListing(raw, 'https://ygp.gdzwfw.gov.cn/#/44/search/jygg');
  assert.equal(item.publishedAt, '2026-09-23 12:34:56');
  assert.match(item.url, /\/v3\/D\?/);
  assert.equal(guangdongListing({ ...raw, edition: 'unknown' }, 'search-source').url, 'search-source');
  assert.throws(() => guangdongListing({ ...raw, regionCode: '310000' }, 'search-source'));
});

test('预算与最高限价分开，采购人与代理机构分开，缺失不填零', () => {
  const fields = extractFields('一、项目编号：TEST-01\n预算金额：100万元；最高限价：80万元\n1.采购人信息\n名 称：合成采购单位\n2.采购代理机构信息\n名 称：合成代理单位\n报名截止时间：2026年09月25日 12:00\n开标时间：2026年10月01日 09:30');
  assert.equal(fields.projectId.value, 'TEST-01');
  assert.equal(fields.buyer.value, '合成采购单位');
  assert.deepEqual(fields.amounts.map(x => [x.kind, x.raw]), [['budget', '100万元'], ['ceiling', '80万元']]);
  assert(fields.dates.some(x => x.kind === 'registration-deadline'));
  assert(fields.dates.some(x => x.kind === 'opening'));
  assert.deepEqual(extractFields('无金额信息').amounts, []);
  assert.equal(extractFields('无编号').projectId.value, null);
});

test('多个项目编号保留歧义，表格型编号可识别', () => {
  assert.equal(extractFields('项目编号：A\n项目编号：B').projectId.status, 'ambiguous');
  assert.equal(extractFields('采购项目编码\tTEST').projectId.value, 'TEST');
});

test('限流和登录页不是零结果，正常公告提及验证码不误报', () => {
  assert(pageProblem('频繁访问', '您的访问过于频繁'));
  assert(pageProblem('登录', '请先登录后继续'));
  assert.equal(pageProblem('公告', '普通公告正文'.repeat(500) + '供应商登录时输入验证码'), null);
});

test('缺失截止时间不借用相邻字段；同行日期按标签隔离且多值保留冲突', () => {
  for (const missing of ['详见采购文件', '', '待定']) {
    const fields = extractFields(`提交投标文件截止时间：${missing}\n开标时间：2026年09月25日18:00:00`);
    assert.equal(fields.dates.some(d => d.kind === 'response-deadline'), false);
    assert.equal(fields.dates.filter(d => d.kind === 'opening').length, 1);
  }
  const mixed = extractFields('报名截止时间：2026年09月24日12:00；投标截止时间：2026年09月25日18:00；开标时间：2026年09月26日09:00');
  assert.equal(mixed.dates.find(d => d.kind === 'response-deadline')!.raw, '2026年09月25日18:00');
  const multiline = extractFields('提交投标文件截止时间：\n2026年09月25日18:00\n如供应商不足三家自动顺延\n开标时间：2026年09月26日09:00');
  assert.match(multiline.dates.find(d => d.kind === 'response-deadline')!.evidence, /自动顺延/);
  const conflict = extractFields('投标截止时间：2026年09月25日18:00 或 2026年09月26日18:00');
  assert.equal(conflict.dates.filter(d => d.kind === 'response-deadline').length, 2);
  const shared = extractFields('四、提交投标文件截止时间、开标时间和地点\n时间：2026年09月25日18:00\n地点：合成地点');
  assert.deepEqual(shared.dates.map(d => [d.kind, d.raw]), [['response-deadline', '2026年09月25日18:00'], ['opening', '2026年09月25日18:00']]);
});
