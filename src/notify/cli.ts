import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { archiveConfig } from '../archive/config.js';
import { acquireLock, atomicFile, initializeRoot } from '../store/files.js';
import { ArchiveStore, backupArchive } from '../store/archive-store.js';
import { json } from '../analysis/persistence.js';
import { selectSnapshot } from '../assistant/catalog.js';
import { notifyConfig } from './config.js';
import { executePreview, resumePreview, reconcilePreview } from './run.js';
import { loadLedger } from './ledger.js';
import { verifyNotifications } from './verify.js';
import { configContract, ledgerContract } from './model.js';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const help = `P5 本地通知预览与手动试运行（不发送，不创建周期任务）
  --preview [--run P3任务] [--purpose formal|diagnostic]
  --resume P5任务 [--purpose ...]       显式重试待处理或已知失败项，有次数上限
  --reconcile 通知ID [--purpose ...]    核对本地文件回执，不进行投递
  --status [--purpose ...]              最近10次任务及通知状态
  --verify                              校验两种用途的账本和成功回执
  --backup                              核验后备份整个归档，包含P5账本，不含登录会话
  --schemas                             更新P5配置和账本字段规范
未知结果不盲目重发；预览成功不代表真实发送或整体业务验收通过。`;

async function main() {
  const { values: v } = parseArgs({ strict: true, allowPositionals: false, options: {
    help: { type: 'boolean' }, preview: { type: 'boolean' }, run: { type: 'string' }, purpose: { type: 'string', default: 'formal' },
    resume: { type: 'string' }, reconcile: { type: 'string' }, status: { type: 'boolean' }, verify: { type: 'boolean' }, backup: { type: 'boolean' }, schemas: { type: 'boolean' },
  } });
  if (v.help) { process.stdout.write(help + '\n'); return; }
  if ([v.preview, v.resume, v.reconcile, v.status, v.verify, v.backup, v.schemas].filter(Boolean).length !== 1 || (v.run && !v.preview)) throw new Error('SELECT_ONE_P5_ACTION');
  if (v.purpose !== 'formal' && v.purpose !== 'diagnostic') throw new Error('INVALID_PURPOSE');
  const selectedPurpose = v.purpose;
  if (v.schemas) {
    for (const [name, contract] of [['notification-config', configContract], ['notification-ledger', ledgerContract]] as const)
      await atomicFile(resolve(project, `schemas/${name}.schema.json`), json({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...contract.schema }));
    process.stdout.write(json({ schemasGenerated: 2 })); return;
  }
  const config = await notifyConfig(project), archive = await archiveConfig(project);
  await initializeRoot(archive.runtimeRoot); const release = await acquireLock(archive.runtimeRoot);
  const controller = new AbortController(); const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const root = archive.runtimeRoot;
    if (v.status) {
      const ledger = await loadLedger(root), deliveries = ledger.deliveries.filter(d => d.event.purpose === v.purpose);
      process.stdout.write(json({ schemaVersion: 1, phase: 'P5', purpose: v.purpose, externalSent: 0, scheduleEnabled: false,
        counts: Object.fromEntries(['pending', 'writing', 'previewed', 'failed', 'unknown'].map(s => [s, deliveries.filter(d => d.state === s).length])),
        totalRuns: ledger.runs.filter(r => r.purpose === v.purpose).length,
        recentRuns: ledger.runs.filter(r => r.purpose === v.purpose).slice(-10).reverse(),
        note: 'writing 可能是进程中断后的未确定状态；需显式 reconcile，不能当作送达成功' })); return;
    }
    if (v.verify || v.backup) {
      const check = await verifyNotifications(root);
      if (!check.ok || v.verify) { process.stdout.write(json(check)); process.exitCode = check.ok ? 0 : 2; return; }
      const store = new ArchiveStore(root);
      try { process.stdout.write(json({ notificationCheck: check, ...await backupArchive(store), sessionsIncluded: false })); }
      finally { store.close(); } return;
    }
    if (v.resume || v.reconcile) {
      const ledger = await loadLedger(root);
      const purpose = v.resume ? ledger.runs.find(r => r.id === v.resume)?.purpose : ledger.deliveries.find(d => d.id === v.reconcile)?.event.purpose;
      if (!purpose) throw new Error('UNKNOWN_P5_RECORD');
      if (purpose !== v.purpose) throw new Error('PURPOSE_MISMATCH');
    }
    if (v.reconcile) {
      const result = await reconcilePreview(root, v.reconcile); process.stdout.write(json(result)); process.exitCode = result.state === 'previewed' ? 0 : 2; return;
    }
    const result = v.resume ? await resumePreview(root, config, v.resume, { signal: controller.signal })
      : await executePreview(root, config, selectedPurpose, () => selectSnapshot(root, selectedPurpose, v.run), { signal: controller.signal });
    process.stdout.write(json(result));
    process.exitCode = result.status === 'complete' ? 0 : result.status === 'cancelled' ? 130 : result.status === 'failed' ? 1 : 2;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await release(); }
}
await main().catch(error => { process.stderr.write(json({ phase: 'P5', status: 'error', code: error instanceof Error && /^[A-Z][A-Z0-9_:]{0,99}$/.test(error.message) ? error.message : 'P5_OPERATION_FAILED' })); process.exitCode = 1; });
