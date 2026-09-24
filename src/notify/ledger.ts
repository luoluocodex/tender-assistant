import { readFile } from 'node:fs/promises';
import { object, string } from '../archive/config.js';
import { json, loadSnapshot } from '../analysis/persistence.js';
import { materialRevision } from '../analysis/revision.js';
import { atomicFile, inside, sha256 } from '../store/files.js';
import { eventId } from './events.js';
import { ledgerContract, type Ledger, type NotifyEvent, type Delivery, type NotifyRun } from './model.js';
import { previewText } from './channel.js';

export function deliveryId(event: NotifyEvent, recipient: string): string { return sha256(json([event.id, 'local-preview', recipient, 'p5-render-v1'])); }
export function recordDelivery(delivery: Delivery): void {
  delivery.updatedAt = new Date().toISOString();
  delivery.history.push({ state: delivery.state, at: delivery.updatedAt, attempt: delivery.attempts, errorCode: delivery.errorCode });
}
export function recordRun(run: NotifyRun): void { run.history.push({ status: run.status, at: new Date().toISOString(), errorCode: run.errorCode }); }
export function notifyRunPath(root: string, id: string): string {
  if (!/^p5-[a-f0-9]{32}$/.test(id)) throw new Error('INVALID_P5_RUN');
  return inside(root, `runs/${id}`);
}
function validate(ledger: Ledger): Ledger {
  const ids = ledger.deliveries.map(d => d.id);
  if (new Set(ids).size !== ids.length || new Set(ledger.runs.map(r => r.id)).size !== ledger.runs.length) throw new Error('DUPLICATE_LEDGER_RECORD');
  for (const d of ledger.deliveries) {
    if (eventId(d.event) !== d.event.id || deliveryId(d.event, d.recipient) !== d.id) throw new Error('DELIVERY_ID_MISMATCH');
    if (d.state === 'previewed' && d.receiptHash !== sha256(previewText(d))) throw new Error('INVALID_PREVIEW_RECEIPT');
    if (!Number.isFinite(Date.parse(d.updatedAt))) throw new Error('INVALID_LEDGER_TIME');
    if (d.history.at(-1)?.state !== d.state || d.history.at(-1)?.attempt !== d.attempts) throw new Error('DELIVERY_HISTORY_MISMATCH');
  }
  for (const run of ledger.runs) {
    if (!/^p5-[a-f0-9]{32}$/.test(run.id) || run.deliveryIds.some(id => !ids.includes(id)) || new Set(run.deliveryIds).size !== run.deliveryIds.length) throw new Error('INVALID_RUN_DELIVERIES');
    if (![run.startedAt, run.referenceTime, ...(run.finishedAt ? [run.finishedAt] : [])].every(t => Number.isFinite(Date.parse(t)))) throw new Error('INVALID_LEDGER_TIME');
    if (run.history.at(-1)?.status !== run.status) throw new Error('RUN_HISTORY_MISMATCH');
  }
  return ledger;
}
/** 单文件哈希封装、原子替换；调用者持有全局归档锁，不维护第二套数据库。 */
export async function loadLedger(root: string): Promise<Ledger> {
  let bytes;
  try { bytes = await readFile(inside(root, 'runs/p5-notifications/ledger.json'), 'utf8'); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { version: 'p5-v2', deliveries: [], runs: [], observations: [] }; throw error; }
  const envelope = object(JSON.parse(bytes)); const payload = string(envelope.payload);
  if (envelope.schemaVersion !== 1 || sha256(payload) !== envelope.sha256) throw new Error('P5_LEDGER_HASH_MISMATCH');
  const raw = object(JSON.parse(payload));
  if (raw.version !== 'p5-v1') return validate(ledgerContract.parse(raw));
  if (!Array.isArray(raw.observations)) throw new Error('INVALID_LEGACY_OBSERVATIONS');
  const migrated = validate(ledgerContract.parse({ ...raw, version: 'p5-v2', observations: raw.observations.map(o => ({ ...object(o), material: null })) }));
  // 只从已校验、版本相符的历史包补元数据；缺失原快照时保持未知，不猜附件先后。
  const pending = new Set(migrated.observations);
  const visited = new Set<string>();
  for (const run of [...migrated.runs].reverse()) {
    if (!pending.size) break;
    if (!run.sourceRun || visited.has(run.sourceRun)) continue;
    visited.add(run.sourceRun);
    let snapshot;
    try { snapshot = await loadSnapshot(root, run.sourceRun); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error; }
    for (const observation of pending) {
      const packet = snapshot.packets.find(p => p.notice.key === observation.subject && p.notice.version === observation.version && p.notice.purpose === observation.purpose);
      if (packet) { observation.material = materialRevision(packet.notice); pending.delete(observation); }
    }
  }
  return migrated;
}
export async function saveLedger(root: string, ledger: Ledger): Promise<void> {
  const payload = json(validate(ledgerContract.parse(ledger)));
  await atomicFile(inside(root, 'runs/p5-notifications/ledger.json'), json({ schemaVersion: 1, sha256: sha256(payload), payload }));
}
