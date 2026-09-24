import { loadLedger } from './ledger.js';
import { LocalPreview } from './channel.js';

/** 核验账本和所有已有成功回执；不把 pending/unknown 伪装成完整备份或送达成功。 */
export async function verifyNotifications(root: string) {
  const ledger = await loadLedger(root); const channel = new LocalPreview(root); const errors: Array<{ id: string; code: string }> = [];
  for (const delivery of ledger.deliveries.filter(d => d.state === 'previewed')) {
    const result = await channel.inspect(delivery);
    if (result.state !== 'previewed' || result.receiptHash !== delivery.receiptHash) errors.push({ id: delivery.id, code: result.errorCode ?? 'RECEIPT_MISMATCH' });
  }
  return { ok: errors.length === 0, deliveries: ledger.deliveries.length, runs: ledger.runs.length,
    unresolved: ledger.deliveries.filter(d => d.state !== 'previewed').length, errors };
}
