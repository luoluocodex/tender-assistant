import { resultContract, type Citation, type ModelResult } from './contract.js';
import type { Packet } from './model.js';
import { verifyPacket } from './packets.js';

/** 逐字引用验证仅证明证据存在，不证明结论在语义上正确。 */
function citations(packet: Packet, values: Citation[], company: boolean): void {
  for (const c of values) {
    const evidence = packet.evidence.find(e => e.id === c.evidenceId);
    if (!evidence || (evidence.kind === 'company') !== company || !evidence.text.includes(c.quote)) throw new Error('INVALID_CITATION');
  }
}
export interface ValidatedAnalysis { original: ModelResult; effective: ModelResult; warnings: string[];
  eligibility: 'mandatory-conflict' | 'insufficient-company-data' | 'needs-human-review'; humanApproved: false }
/** 失败不接受结果；通过后保留原输出及降级后的结论，缺资料不能自动转为符合。 */
export function validateResult(value: unknown, packet: Packet): ValidatedAnalysis {
  verifyPacket(packet); const original = resultContract.parse(value);
  for (const field of ['packetId', 'inputHash', 'promptVersion', 'companyVersion'] as const) {
    if (original[field] !== packet[field]) throw new Error(`STALE_RESULT:${field}`);
  }
  if (original.ruleVersion !== packet.rules.version) throw new Error('STALE_RESULT:ruleVersion');
  citations(packet, original.relevance.citations, false);
  for (const c of [...original.summary.facts, ...original.summary.inferences]) citations(packet, c.citations, false);
  if (new Set(original.requirements.map(r => r.id)).size !== original.requirements.length) throw new Error('DUPLICATE_REQUIREMENT');
  for (const r of original.requirements) { citations(packet, r.citations, false); citations(packet, r.companyCitations, true); }
  const effective = structuredClone(original); const warnings: string[] = [];
  const incomplete = packet.coverage.body !== 'complete' || !['none-listed', 'all-listed-parsed-not-content-certified'].includes(packet.coverage.attachments);
  if (incomplete && effective.relevance.decision === 'irrelevant') {
    effective.relevance.decision = 'review'; warnings.push('正文或附件不完整，不接受自动判为不相关');
  }
  for (const r of effective.requirements) {
    if (!packet.company || !r.companyCitations.length) {
      if (r.status !== '资料不足') warnings.push(`${r.id}:缺少公司证据，降级为资料不足`);
      r.status = '资料不足';
    } else if (r.status === '符合' || r.status === '不符合') {
      const outdated = r.companyCitations.some(c => {
        const ev = packet.evidence.find(e => e.id === c.evidenceId)!;
        const fact = packet.company!.facts.find(f => ev.locator.startsWith(`${f.id}:chars-`));
        const until = fact?.validUntil;
        if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return true;
        const date = Date.parse(`${until}T00:00:00Z`);
        return !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== until || until < packet.notice.window.endDate;
      });
      if (outdated || (incomplete && r.status === '符合')) {
        r.status = '待复核'; warnings.push(`${r.id}:材料有效性或采购完整性不足`);
      }
    }
  }
  if (!effective.requirements.length) warnings.push('未提取资格条款，不代表无资格要求');
  if (incomplete) warnings.push('正文或附件范围不完整，不能作为完整资格审查');
  if (packet.company) warnings.push('公司数据是合成测试资料，不是实际公司的资格结论');
  if (packet.decision.tracked && ['changed', 'terminated', 'result', 'contract'].includes(packet.decision.stage) && effective.relevance.decision === 'irrelevant') {
    effective.relevance.decision = 'review'; warnings.push('已跟踪项目更新保留供复核');
  }
  const mandatoryConflict = effective.requirements.some(r => r.category === 'mandatory' && r.status === '不符合');
  return { original, effective, warnings, eligibility: mandatoryConflict ? 'mandatory-conflict' : !packet.company ? 'insufficient-company-data' : 'needs-human-review', humanApproved: false };
}
