import { atomicFile, inside } from '../store/files.js';
import { json } from '../analysis/persistence.js';
import { notifyRunPath } from './ledger.js';
import { previewPath, previewText } from './channel.js';
import type { Ledger, NotifyRun } from './model.js';

export function runSummary(root: string, ledger: Ledger, run: NotifyRun) {
  const deliveries = ledger.deliveries.filter(d => run.deliveryIds.includes(d.id));
  const counts = { pending: 0, writing: 0, previewed: 0, failed: 0, unknown: 0 };
  for (const d of deliveries) counts[d.state]++;
  return { schemaVersion: 1, phase: 'P5', ...run, counts, channel: 'local-preview', externalSent: 0, scheduleEnabled: false,
    artifact: inside(notifyRunPath(root, run.id), 'preview.md'),
    deliveries: deliveries.map(d => ({ id: d.id, type: d.event.type, state: d.state, attempts: d.attempts, errorCode: d.errorCode, preview: previewPath(root, d.id) })),
    limitations: ['仅本地文件预览，previewed 不等于已发送', '未重新采集网站；历史快照不能保证当前仍可投标', '真实通知渠道和跨日试运行未验收'] };
}
/** 重建报告只读取账本，不改变送达状态；即使上次生成报告失败也可单独恢复。 */
export async function writeRunReport(root: string, ledger: Ledger, run: NotifyRun) {
  const result = runSummary(root, ledger, run); const dir = notifyRunPath(root, run.id);
  await atomicFile(inside(dir, 'report.json'), json(result));
  const messages = ledger.deliveries.filter(d => run.deliveryIds.includes(d.id));
  const header = ['# P5 通知预览', '', `任务：${run.id}；状态：${run.status}；用途：${run.purpose}`, '',
    `本轮新增 ${run.added}；复用 ${run.reused}。本地预览 ${result.counts.previewed}；待处理 ${result.counts.pending}；失败 ${result.counts.failed}；结果未知 ${result.counts.unknown + result.counts.writing}。`,
    '外部发送 0；周期调度关闭。这里只是现有材料的观察记录，不是采集检查点。', '', `错误：${run.errorCode ?? '无'}`, ''];
  await atomicFile(inside(dir, 'preview.md'), header.join('\n') + messages.map(d => `\n---\n\n状态：${d.state}\n\n${previewText(d)}`).join(''));
  return result;
}
