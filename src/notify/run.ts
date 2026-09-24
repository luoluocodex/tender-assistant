import { randomUUID } from 'node:crypto';
import type { AnalysisSnapshot } from '../analysis/model.js';
import { LocalPreview } from './channel.js';
import { planEvents } from './events.js';
import { deliveryId, loadLedger, saveLedger, recordDelivery, recordRun } from './ledger.js';
import { writeRunReport } from './report.js';
import type { Ledger, NotifyConfig, NotifyRun, PreviewChannel } from './model.js';

function recoverInterrupted(ledger: Ledger): void {
  for (const d of ledger.deliveries) if (d.state === 'writing') { d.state = 'unknown'; d.errorCode = 'INTERRUPTED_DURING_WRITE'; recordDelivery(d); }
  for (const run of ledger.runs) if (run.status === 'running') { run.status = 'partial'; run.errorCode = 'INTERRUPTED'; run.finishedAt = new Date().toISOString(); recordRun(run); }
}
const failureCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_:]{0,99}$/.test(error.message) ? error.message : 'P5_OPERATION_FAILED';
function finish(ledger: Ledger, run: NotifyRun, cancelled: boolean): void {
  const deliveries = ledger.deliveries.filter(d => run.deliveryIds.includes(d.id));
  run.status = cancelled ? 'cancelled' : deliveries.every(d => d.state === 'previewed') ? 'complete' : 'partial';
  run.finishedAt = new Date().toISOString();
  recordRun(run);
}

/** 每次领取之前记录 writing；未确定结果不会自动重试，取消保留 pending 供显式恢复。 */
async function drain(root: string, ledger: Ledger, run: NotifyRun, config: NotifyConfig, channel: PreviewChannel, retry: boolean, signal?: AbortSignal) {
  for (const d of ledger.deliveries.filter(d => run.deliveryIds.includes(d.id))) {
    if (signal?.aborted) break;
    if (d.state !== 'pending' && !(retry && d.state === 'failed')) continue;
    if (d.attempts >= config.maxAttempts) continue;
    d.state = 'writing'; d.attempts++; d.updatedAt = new Date().toISOString(); d.errorCode = null;
    recordDelivery(d);
    await saveLedger(root, ledger);
    try { Object.assign(d, await channel.deliver(d)); }
    catch { d.state = 'unknown'; d.receiptHash = null; d.errorCode = 'CHANNEL_RESULT_UNKNOWN'; }
    recordDelivery(d); await saveLedger(root, ledger);
  }
  finish(ledger, run, signal?.aborted ?? false);
  await saveLedger(root, ledger); return writeRunReport(root, ledger, run);
}

/** 一次手动试运行：先写运行记录，再准备事件、投递本地预览。调用者必须持有 archive 锁。 */
export async function executePreview(root: string, config: NotifyConfig, purpose: 'formal' | 'diagnostic',
  source: () => Promise<AnalysisSnapshot | null>, options: { now?: Date; channel?: PreviewChannel; signal?: AbortSignal } = {}) {
  const ledger = await loadLedger(root); recoverInterrupted(ledger);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_REFERENCE_TIME');
  const run: NotifyRun = { id: `p5-${randomUUID().replaceAll('-', '')}`, purpose, sourceRun: null, startedAt: new Date().toISOString(),
    referenceTime: now.toISOString(), finishedAt: null, status: 'running', deliveryIds: [], added: 0, reused: 0, errorCode: null, history: [] };
  recordRun(run); ledger.runs.push(run); await saveLedger(root, ledger);
  try {
    const snapshot = await source();
    if (!snapshot) throw new Error('NO_ANALYSIS_RUN');
    if (snapshot.purpose !== purpose) throw new Error('PURPOSE_MISMATCH');
    run.sourceRun = snapshot.id;
    const plan = await planEvents(root, snapshot, config, ledger.observations, now);
    for (const event of plan.events) {
      const id = deliveryId(event, config.recipient);
      if (run.deliveryIds.includes(id)) continue;
      run.deliveryIds.push(id);
      if (ledger.deliveries.some(d => d.id === id)) run.reused++;
      else { run.added++; ledger.deliveries.push({ id, event, channel: 'local-preview', recipient: config.recipient,
        state: 'pending', attempts: 0, updatedAt: now.toISOString(), errorCode: null, receiptHash: null,
        history: [{ state: 'pending', at: new Date().toISOString(), attempt: 0, errorCode: null }] }); }
    }
    for (const observation of plan.observations) {
      const index = ledger.observations.findIndex(o => o.purpose === observation.purpose && o.subject === observation.subject);
      if (index < 0) ledger.observations.push(observation); else ledger.observations[index] = observation;
    }
    await saveLedger(root, ledger);
    return await drain(root, ledger, run, config, options.channel ?? new LocalPreview(root), false, options.signal);
  } catch (error) {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.errorCode = failureCode(error);
    recordRun(run);
    await saveLedger(root, ledger); return writeRunReport(root, ledger, run);
  }
}

/** 显式恢复只重试 pending/已知失败；unknown 必须先核对本地文件回执。 */
export async function resumePreview(root: string, config: NotifyConfig, id: string, options: { channel?: PreviewChannel; signal?: AbortSignal } = {}) {
  const ledger = await loadLedger(root); recoverInterrupted(ledger);
  const run = ledger.runs.find(r => r.id === id); if (!run) throw new Error('UNKNOWN_P5_RUN');
  if (run.errorCode && !run.deliveryIds.length && run.status === 'failed') throw new Error('PREPARE_FAILED_RERUN_REQUIRED');
  run.errorCode = null; run.status = 'running'; recordRun(run); await saveLedger(root, ledger);
  return drain(root, ledger, run, config, options.channel ?? new LocalPreview(root), true, options.signal);
}

/** 仅核对本地确定性文件，不产生新投递。缺失可标已知失败，内容冲突继续 unknown。 */
export async function reconcilePreview(root: string, id: string) {
  const ledger = await loadLedger(root); recoverInterrupted(ledger);
  const delivery = ledger.deliveries.find(d => d.id === id); if (!delivery) throw new Error('UNKNOWN_DELIVERY');
  Object.assign(delivery, await new LocalPreview(root).inspect(delivery)); delivery.updatedAt = new Date().toISOString();
  recordDelivery(delivery);
  for (const run of ledger.runs.filter(r => r.deliveryIds.includes(id))) finish(ledger, run, false);
  await saveLedger(root, ledger);
  for (const run of ledger.runs.filter(r => r.deliveryIds.includes(id))) await writeRunReport(root, ledger, run);
  return { deliveryId: id, state: delivery.state, errorCode: delivery.errorCode, externalSent: 0 };
}
