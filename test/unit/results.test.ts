import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Listing, QueryResult } from '../../src/model.js';
import { addListings, finishQuery, listingKey, pageSignature } from '../../src/run/results.js';
import { createWindow } from '../../src/run/window.js';
import { chooseSamples, siteStopped } from '../../src/run/collect.js';

const item = (id: string, publishedAt: string | null = '2026-09-20 12:00:00'): Listing => ({ site: 'ccgp', id, title: '构造测试公告', url: `https://example.invalid/${id}`, publishedAt, region: '广东', noticeType: '采购', evidence: '合成样本' });
const result = (): QueryResult => ({ id: 'test', site: 'ccgp', keyword: '测试', region: '广东', mode: 'fulltext', window: createWindow(new Date('2026-09-23T09:00:00Z')), status: 'running', reason: '', totalReported: null, pages: [], listings: [], duplicates: 0, excluded: [], needsReview: [], queryEvidence: {} });

test('仅来源内去重，缺失日期保留，超界结果记录排除证据', () => {
  const query = result();
  addListings(query, [item('a'), item('a'), item('b', null), item('c', '2026-09-16')]);
  addListings(query, [item('a'), item('c', '2026-09-16')]);
  assert.equal(query.listings.length, 2);
  assert.equal(query.duplicates, 3);
  assert.equal(query.needsReview.length, 1);
  assert.equal(query.excluded.length, 1);
  assert.notEqual(listingKey(item('a')), listingKey({ ...item('a'), site: 'another' }));
  assert.equal(pageSignature([item('a')]), pageSignature([item('a')]));
});

test('成功零结果、覆盖不足和页数上限分别记录', () => {
  const zero = result(); zero.totalReported = 0; finishQuery(zero, true);
  assert.equal(zero.status, 'complete');
  assert.match(zero.reason, /零结果/);
  const limited = result(); limited.totalReported = 10; addListings(limited, [item('a')]); finishQuery(limited, false);
  assert.equal(limited.status, 'partial');
  const missing = result(); missing.totalReported = 10; addListings(missing, [item('a')]); finishQuery(missing, true);
  assert.equal(missing.status, 'partial');
  assert.match(missing.reason, /覆盖不足/);
});

test('详情抽样去重并覆盖多种公告类型，遵守上限', () => {
  const source = [item('a'), item('a'), item('b'), { ...item('c'), noticeType: '更正' }, item('d')];
  assert.deepEqual(chooseSamples(source, 2).map(x => x.id), ['a', 'c']);
  assert.deepEqual(chooseSamples(source, 2, [item('a'), item('d')]).map(x => x.id), ['a', 'd']);
});

test('HTTP 429/403 停止该站后续请求，不阻塞其他站点', () => {
  const query = result();
  query.status = 'partial';
  query.queryEvidence.accessFailure = { status: 429, retryAfter: '120' };
  assert.equal(siteStopped([query], 'ccgp'), true);
  assert.equal(siteStopped([query], 'guangdong-public-resources'), false);
  query.queryEvidence.accessFailure = { status: 403 };
  assert.equal(siteStopped([query], 'ccgp'), true);
  query.queryEvidence.accessFailure = { status: 500 };
  assert.equal(siteStopped([query], 'ccgp'), false);
});
