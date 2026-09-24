import { readFile } from 'node:fs/promises';
import { object, string } from '../archive/config.js';
import type { AnalysisSnapshot, Packet } from '../analysis/model.js';
import { json, readResults } from '../analysis/persistence.js';
import { effectiveDecision } from '../analysis/report.js';
import { safeText } from '../analysis/source.js';
import { sha256 } from '../store/files.js';
import { deadlineBucket, deadlineInstant } from './deadline.js';
import type { NotifyConfig, NotifyEvent, Observation } from './model.js';

export function eventId(event: Omit<NotifyEvent, 'id'>): string {
  // sourceRun 仅作为第一次发现的溯源，不使同一事件在新一轮快照中重复通知。
  return sha256(json({ type: event.type, purpose: event.purpose, subject: event.subject, version: event.version,
    title: event.title, message: event.message, url: event.url, evidence: event.evidence }));
}
function makeEvent(event: Omit<NotifyEvent, 'id'>): NotifyEvent { return { ...event, id: eventId(event) }; }
const data = (p: Packet) => ({ purpose: p.notice.purpose, subject: p.notice.key, title: p.notice.listing.title, url: p.notice.listing.url });

async function queryProblems(snapshot: AnalysisSnapshot): Promise<NotifyEvent[]> {
  let bytes: Buffer;
  try { bytes = await readFile(snapshot.sourceReport); } catch { throw new Error('P1_SOURCE_UNAVAILABLE'); }
  if (sha256(bytes) !== snapshot.reportHash) throw new Error('P1_SOURCE_HASH_MISMATCH');
  const report = object(JSON.parse(bytes.toString('utf8')));
  if (report.phase !== 'P1' || report.purpose !== snapshot.purpose || !Array.isArray(report.queries)) throw new Error('INVALID_P1_REPORT');
  const problems = report.queries.map(raw => object(raw)).filter(q => q.status !== 'complete');
  const events = problems.map(q => makeEvent({ type: 'run-problem', purpose: snapshot.purpose, sourceRun: snapshot.id,
    subject: `query:${string(q.id)}`, version: snapshot.reportHash, title: '采集未完整完成，需要复核或人工接管',
    message: safeText(`${string(q.site)} / ${string(q.status)}：${string(q.reason)}。不推进整批采集检查点，不把失败当作零结果。`).slice(0, 6000),
    url: null, evidence: [{ locator: `P1.queries:${string(q.id)}`, quote: safeText(string(q.reason)).slice(0, 2000) }] }));
  if (report.status !== 'complete' && events.length === 0) events.push(makeEvent({ type: 'run-problem', purpose: snapshot.purpose, sourceRun: snapshot.id,
    subject: 'collection-run', version: snapshot.reportHash, title: '采集任务未完整完成', message: '来源任务为部分完成、失败或取消；请查看原始运行报告的详情与错误范围。', url: null, evidence: [] }));
  return events;
}

/** 基于真实快照和已校验模型结果生成通知；不重新采集，不将候选当作已确认商机。 */
export async function planEvents(root: string, snapshot: AnalysisSnapshot, config: NotifyConfig, previous: Observation[], now: Date) {
  const events = await queryProblems(snapshot);
  const results = await readResults(root, snapshot);
  const versions = new Set(snapshot.projects.flatMap(p => p.currentNoticeVersions));
  const current = snapshot.packets.filter(p => versions.has(p.notice.version));
  const observations: Observation[] = [];
  let deferredDeadlines = 0, stale = 0;
  for (const p of current) {
    const prior = previous.find(o => o.purpose === snapshot.purpose && o.subject === p.notice.key);
    const contentHash = sha256(json({ notice: p.notice.version, attachments: p.notice.attachments.map(a => [a.sha256, a.parseSha]) }));
    if (prior?.fetchedAt && p.notice.fetchedAt && Date.parse(p.notice.fetchedAt) < Date.parse(prior.fetchedAt)) { stale++; continue; }
    if (prior && prior.contentHash !== contentHash && (!p.notice.fetchedAt || !prior.fetchedAt || Date.parse(p.notice.fetchedAt) <= Date.parse(prior.fetchedAt))) { stale++; continue; }
    const result = results.get(p.packetId), decision = effectiveDecision(p, result);
    const relevant = decision === 'related' || p.decision.tracked || prior?.relevant === 'yes';
    observations.push({ purpose: snapshot.purpose, subject: p.notice.key, version: p.notice.version, contentHash,
      fetchedAt: p.notice.fetchedAt, relevant: relevant ? 'yes' : 'no' });
    // 通知内容版本排除抓取时刻、时间窗、packetId 和模型运行标识，避免同一业务内容每日重复。
    const version = sha256(json({ contentHash, rule: p.rules.version, prompt: p.promptVersion, company: p.companyVersion,
      relevance: result?.effective.relevance ?? null, summary: result?.effective.summary ?? null, requirements: result?.effective.requirements ?? null }));
    const locator = `${p.notice.key}@${p.notice.version}`;
    if (decision === 'related') events.push(makeEvent({ ...data(p), sourceRun: snapshot.id, version, type: 'related-notice',
      message: `AI 初步判断相关；公告阶段：${p.decision.stage}。${result!.effective.relevance.reason}。公司资格仍需人工复核。`.slice(0, 6000),
      evidence: result!.effective.relevance.citations.map(c => ({ locator: `${locator}:${c.evidenceId}`, quote: c.quote })) }));
    const changed = relevant && (['changed', 'terminated', 'contract', 'result'].includes(p.decision.stage) || (prior && prior.contentHash !== contentHash));
    if (changed) events.push(makeEvent({ ...data(p), sourceRun: snapshot.id, version: contentHash, type: 'project-update',
      message: `已跟踪或曾相关的公告有更新，当前阶段：${p.decision.stage}。只作用于本公告及其标包，变更范围、资格与有效期需复核。`,
      evidence: [{ locator: `${locator}:title-1`, quote: p.notice.listing.title.slice(0, 2000) }] }));
    if (!relevant || decision === 'irrelevant' || p.decision.stage !== 'procurement') continue;
    const group = snapshot.projects.find(g => g.currentNoticeVersions.includes(p.notice.version));
    const dates = p.notice.fields.dates.filter(d => d.kind === 'response-deadline');
    const unique = [...new Set(dates.map(d => d.raw))];
    const deadline = unique.length === 1 ? deadlineInstant(unique[0]!) : null;
    const conditional = dates.some(d => /如|若|自动|顺延|可能|原定|原为|变更前|延期/.test(d.evidence));
    if (deadline === null || conditional || group?.status !== 'procurement' || group.warnings.some(w => /更正|标包/.test(w))) { deferredDeadlines++; continue; }
    const bucket = deadlineBucket(deadline, now.getTime(), config.deadlineHours);
    if (bucket !== null) events.push(makeEvent({ ...data(p), sourceRun: snapshot.id,
      version: sha256(json({ contentHash, deadline, bucket })), type: 'deadline',
      message: `已观察的响应截止时间 ${unique[0]}（北京时间）进入 ${bucket} 小时窗口。以原网站最新公告为准，本快照不代表资格通过或尚可报名。`,
      evidence: [{ locator: `${locator}:fields.dates.response-deadline`, quote: dates[0]!.evidence.slice(0, 2000) }] }));
  }
  const pending = current.filter(p => !results.has(p.packetId)).length;
  const review = current.filter(p => effectiveDecision(p, results.get(p.packetId)) === 'review').length;
  if (pending || review || deferredDeadlines || stale) events.push(makeEvent({ type: 'review-required', purpose: snapshot.purpose,
    sourceRun: snapshot.id, subject: 'analysis-coverage', title: '分析与资料缺口汇总', url: null,
    version: sha256(json({ report: snapshot.reportHash, packets: current.map(p => [p.inputHash, results.get(p.packetId)?.effective ?? null]), deferredDeadlines, stale })),
    message: `当前候选 ${current.length}，未分析 ${pending}，待复核 ${review}；临期时间需复核 ${deferredDeadlines}，忽略旧内容或无法确定先后的版本 ${stale}。缺失不等于不相关；无真实公司资料，通知未外发。`, evidence: [] }));
  return { events, observations };
}
