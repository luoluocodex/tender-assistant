import type { Notice, Packet, RuleConfig, AnalysisSnapshot } from '../../src/analysis/model.js';
import type { ModelResult, Company } from '../../src/analysis/contract.js';
import { makePacket } from '../../src/analysis/packets.js';
import { extractFields } from '../../src/sites/fields.js';
import { createWindow } from '../../src/run/window.js';
import { sha256 } from '../../src/store/files.js';
import { associate } from '../../src/analysis/rules.js';

export const testRules: RuleConfig = { version: 'synthetic-v1', keyword: '网站开发', region: '广东省', excludeKeywords: [] };
export const testPrompts = { relevance: '合成测试提示词，不用于真实模型评估', summary: '合成摘要', qualification: '合成资格' };
export function notice(id = '1', title = '合成网站开发采购公告', body = '项目编号：TEST-1\n采购人：合成采购方\n具备测试资质甲级'): Notice {
  return { key: `synthetic:${id}`, version: sha256(id + title + body), purpose: 'diagnostic',
    listing: { site: 'synthetic', id, title, url: `https://example.invalid/${id}`, publishedAt: '2026-09-22 10:00:00', region: '广东', noticeType: '采购公告', evidence: title },
    text: body, completeness: 'complete', fields: extractFields(body), fetchedAt: '2026-09-23T10:00:00Z', attachmentCount: 0, attachments: [],
    window: createWindow(new Date('2026-09-23T11:00:00Z'), 7), queryComplete: true, queryIds: ['synthetic-query'] };
}
export function packet(n = notice(), company: Company | null = null): Packet { return makePacket(n, testRules, testPrompts, company); }
export function modelResult(p: Packet, decision: 'related' | 'irrelevant' | 'review' = 'related'): ModelResult {
  const title = p.evidence[0]!; const procurement = p.evidence.find(e => e.text.includes('具备测试资质')) ?? title;
  return { packetId: p.packetId, inputHash: p.inputHash, ruleVersion: p.rules.version, promptVersion: p.promptVersion, companyVersion: p.companyVersion,
    provider: 'codex-session', model: 'synthetic-model-output-not-real-inference',
    relevance: { decision, reason: '合成输出', citations: [{ evidenceId: title.id, quote: title.text }] },
    summary: { facts: [{ text: '合成摘要', citations: [{ evidenceId: title.id, quote: title.text }] }], inferences: [], missing: ['合成数据没有实际公司'] },
    requirements: [{ id: 'q1', category: 'mandatory', scope: '项目', text: '测试资质', citations: [{ evidenceId: procurement.id, quote: procurement.text }], companyCitations: [], status: '资料不足', reason: '合成测试' }],
    limitations: ['仅合成测试，不是业务成果'] };
}
export function snapshot(packets = [packet()]): AnalysisSnapshot {
  return { schemaVersion: 1, phase: 'P3', id: `p3-${sha256(JSON.stringify(packets)).slice(0,24)}`, purpose: 'diagnostic', createdAt: '2026-09-23T11:00:00Z', reportHash: sha256('synthetic'), sourceReport: 'synthetic', rules: testRules,
    packets, projects: associate(packets.map(p => p.notice)), p3AcceptanceComplete: false };
}
