import { atomicFile, inside } from '../store/files.js';
import type { AnalysisSnapshot, Packet } from './model.js';
import { labelsContract } from './contract.js';
import { readResults, runPath, json } from './persistence.js';
import type { ValidatedAnalysis } from './validation.js';

export function effectiveDecision(packet: Packet, result?: ValidatedAnalysis): 'related' | 'irrelevant' | 'review' {
  if (packet.decision.disposition === 'exclude') return 'irrelevant';
  return result?.effective.relevance.decision ?? 'review';
}
const md = (value: string) => value.replace(/[|`<>\[\]\\]/g, c => `&#${c.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ');
/** CSV 双引号转义并阻止 Excel 把网页文本解释为公式。 */
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@\-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
/** 输出确定性清单和明确标识的 AI 摘要；没有模型结果时保留待分析状态。 */
export async function writeReport(root: string, snapshot: AnalysisSnapshot): Promise<Record<string, unknown>> {
  const results = await readResults(root, snapshot); const dir = runPath(root, snapshot.id);
  const currentVersions = new Set(snapshot.projects.flatMap(p => p.currentNoticeVersions));
  const rows = snapshot.packets.map(p => {
    const r = results.get(p.packetId);
    return { packetId: p.packetId, inputHash: p.inputHash, noticeKey: p.notice.key, noticeVersion: p.notice.version,
      title: p.notice.listing.title, url: p.notice.listing.url, purpose: p.notice.purpose, publishedAt: p.notice.listing.publishedAt,
      versionState: currentVersions.has(p.notice.version) ? 'current-observed' : 'superseded',
      stage: p.decision.stage, rule: p.decision, decision: effectiveDecision(p, r), modelStatus: r ? 'analyzed-needs-human-review' : 'pending',
      fields: p.notice.fields, coverage: p.coverage, companyVersion: p.companyVersion,
      analysis: r?.effective ?? null, eligibility: r?.eligibility ?? (p.company ? 'needs-human-review' : 'insufficient-company-data'), warnings: r?.warnings ?? [] };
  });
  const counts = { candidates: rows.length, modelAnalyzed: results.size, pending: rows.length - results.size,
    related: rows.filter(r => r.decision === 'related').length, irrelevant: rows.filter(r => r.decision === 'irrelevant').length,
    review: rows.filter(r => r.decision === 'review').length };
  const report = { schemaVersion: 1, phase: 'P3', id: snapshot.id, purpose: snapshot.purpose, sourceReportHash: snapshot.reportHash,
    counts, rules: snapshot.rules, projects: snapshot.projects, rows, p3AcceptanceComplete: false,
    limitations: ['仅已有快照，未重新查询网站或补齐未采集详情', '未完成人工标注验收', 'AI 引文校验不代表语义或投标资格人工核验通过'], notification: 'preview-only-not-sent' };
  await atomicFile(inside(dir, 'report.json'), json(report));
  const lines = [`# P3 分析报告`, '', `运行：${snapshot.id}；用途：${snapshot.purpose === 'formal' ? '正式查询快照' : '诊断样本，不计入正式商机'}。`, '',
    `候选 ${counts.candidates}；AI 已分析 ${counts.modelAnalyzed}；待分析 ${counts.pending}。相关 ${counts.related}，不相关 ${counts.irrelevant}，待复核 ${counts.review}。`, '',
    '当前公司资料未提供（如指定合成公司则仅为测试）；全部结果仍需人工复核。历史快照不代表当前正在招标。', '',
    '| 公告 | 阶段 | 相关性 | 模型状态 | 材料范围 |', '|---|---|---|---|---|'];
  for (const row of rows) lines.push(`| ${md(row.title)} | ${row.stage} | ${row.decision} | ${row.modelStatus} | ${row.coverage.body} / ${row.coverage.attachments} |`);
  for (const p of snapshot.packets) {
    const r = results.get(p.packetId); if (!r) continue;
    lines.push('', `## ${md(p.notice.listing.title)}`, '', `来源：[公告](${p.notice.listing.url})；版本 ${p.notice.version.slice(0, 12)}；${p.packetId}。`, '', md(r.effective.relevance.reason));
    const quote = (id: string, text: string) => {
      const e = p.evidence.find(e => e.id === id)!;
      return `${md(e.locator)}〔${id}〕：“${md(text)}”`;
    };
    for (const [kind, claims] of [['事实', r.effective.summary.facts], ['推断', r.effective.summary.inferences]] as const) {
      for (const claim of claims) lines.push('', `- ${kind}：${md(claim.text)} ${claim.citations.map(c => quote(c.evidenceId, c.quote)).join('；')}`);
    }
    lines.push('', `缺口：${r.effective.summary.missing.map(md).join('；') || '模型未列出，仍需复核'}`, '', '| 采购要求 | 类别 / 范围 | 结论 | 证据与理由 |', '|---|---|---|---|');
    for (const req of r.effective.requirements) lines.push(`| ${md(req.text)} | ${req.category} / ${md(req.scope)} | ${req.status} | ${md(req.reason)}；${req.citations.map(c => quote(c.evidenceId, c.quote)).join('；')} |`);
    lines.push('', `限制：${[...r.effective.limitations, ...r.warnings].map(md).join('；')}`);
  }
  await atomicFile(inside(dir, 'report.md'), lines.join('\n') + '\n');
  const csv = [['公告标识', '标题', '用途', '发布时间', '公告阶段', '相关性', '模型状态', '公司资格', '来源'],
    ...rows.map(r => [r.noticeKey, r.title, r.purpose, r.publishedAt ?? '', r.stage, r.decision, r.modelStatus, r.eligibility, r.url])];
  await atomicFile(inside(dir, 'list.csv'), '\uFEFF' + csv.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  await atomicFile(inside(dir, 'review-labels.template.json'), json({ kind: 'human', reviewer: '待填写', labels: snapshot.packets.filter(p => p.notice.completeness !== 'not-collected').map(p => ({ packetId: p.packetId, inputHash: p.inputHash, label: null, note: '' })) }));
  return counts;
}
/** 人工标签必须显式提交；空标签、重复标签和旧版本不能混入评估分母。 */
export async function evaluate(root: string, snapshot: AnalysisSnapshot, raw: unknown): Promise<Record<string, unknown>> {
  const labels = labelsContract.parse(raw); if (labels.reviewer === '待填写') throw new Error('REVIEWER_REQUIRED');
  if (new Set(labels.labels.map(l => l.packetId)).size !== labels.labels.length) throw new Error('DUPLICATE_LABEL');
  const results = await readResults(root, snapshot); let positive = 0, predicted = 0, correct = 0, retained = 0, review = 0, pending = 0;
  const errors: Array<Record<string, unknown>> = [];
  for (const label of labels.labels) {
    const p = snapshot.packets.find(p => p.packetId === label.packetId);
    if (!p || label.inputHash !== p.inputHash) throw new Error('STALE_OR_UNKNOWN_LABEL');
    const decision = effectiveDecision(p, results.get(p.packetId));
    if (!results.has(p.packetId)) pending++;
    if (decision === 'review') review++;
    if (decision === 'related') { predicted++; if (label.label === 'related') correct++; }
    if (label.label === 'related') { positive++; if (decision !== 'irrelevant') retained++; }
    if (decision !== label.label) errors.push({ ...label, actual: decision, reason: decision === 'review' ? 'needs-review' : 'misclassification' });
  }
  const precision = predicted ? correct / predicted : null; const retainedRecall = positive ? retained / positive : null;
  const minimumSampleMet = labels.kind === 'human' && positive >= 20 && labels.labels.length - positive >= 20;
  const metrics = { kind: labels.kind, reviewer: labels.reviewer, count: labels.labels.length, positive, negative: labels.labels.length - positive,
    predictedRelated: predicted, precision, retainedRecall, reviewRate: review / labels.labels.length, pending,
    minimumSampleMet, suggestedThresholdsMet: minimumSampleMet && pending === 0 && precision !== null && precision >= 0.9 && retainedRecall !== null && retainedRecall >= 0.95,
    errors, note: '建议阈值不等于用户已确认的最终验收；合成评估不替代人工标注集' };
  await atomicFile(inside(runPath(root, snapshot.id), `evaluation-${labels.kind}.json`), json(metrics));
  return metrics;
}
