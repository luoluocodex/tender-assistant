import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArchiveStore } from '../../src/store/archive-store.js';
import { initializeRoot, sha256 } from '../../src/store/files.js';
import { readSource } from '../../src/analysis/source.js';
import { importResult, json, loadSnapshot, readResults, saveSnapshot } from '../../src/analysis/persistence.js';
import { executePreview } from '../../src/notify/run.js';
import { loadLedger } from '../../src/notify/ledger.js';
import { ledgerContract } from '../../src/notify/model.js';
import { fixtureRoot, syntheticCandidate, syntheticPdf } from './archive-fixtures.js';
import { modelResult, notice, packet, snapshot } from './analysis-fixtures.js';
import { clock, notifyFixture, notifyTestConfig, tender } from './notify-fixtures.js';

test('P2 附件刷新经 P3 previous 只选新材料；P5 迁移旧账本、提醒、重跑去重和旧快照防回退', async () => {
  const root = await fixtureRoot(); await initializeRoot(root, false); const store = new ArchiveStore(root);
  try {
    const n = notice('attachment'), candidate = syntheticCandidate(); candidate.noticePayload = { listing: n.listing, text: n.text };
    const job = await store.createJob([candidate], 'synthetic'), item = store.items(job)[0]!;
    const save = (version: string) => store.save(item, Buffer.concat([syntheticPdf(), Buffer.from(version)]),
      { parserVersion: 'p2-v1', kind: 'pdf', status: 'parsed', reason: '', units: [{ locator: 'page:1', text: `合成条款 ${version}` }], members: [] }, candidate.url, 'synthetic-refresh');
    const reportPath = join(root, 'source-p1.json');
    const report = json({ phase: 'P1', purpose: 'diagnostic', status: 'complete', window: n.window,
      queries: [{ id: 'q', site: 'synthetic', status: 'complete', reason: '完整', listings: [n.listing], excluded: [] }],
      details: [{ listing: n.listing, text: n.text, sha256: sha256(n.text), status: 'complete', fetchedAt: n.fetchedAt, attachments: [{ name: candidate.name, url: candidate.url }] }] });
    await writeFile(reportPath, report); await save('A');
    const oldNotice = (await readSource(reportPath, root, job)).notices[0]!;
    delete oldNotice.attachments[0]!.observation; // 模拟升级前已生成的 P3 包。
    const oldPacket = packet(oldNotice), first = snapshot([oldPacket]);
    first.sourceReport = reportPath; first.reportHash = sha256(report);
    await saveSnapshot(root, first); await importResult(root, first, modelResult(oldPacket));
    await executePreview(root, notifyTestConfig, 'diagnostic', async () => first, { now: clock });
    const legacy = await loadLedger(root), ledgerPath = join(root, 'runs/p5-notifications/ledger.json');
    const payload = json({ ...legacy, version: 'p5-v1', observations: legacy.observations.map(({ material: _material, ...row }) => row) });
    await writeFile(ledgerPath, json({ schemaVersion: 1, sha256: sha256(payload), payload }));
    const migrated = await loadLedger(root); assert.equal(migrated.version, 'p5-v2'); assert.ok(migrated.observations[0]!.material);
    assert.deepEqual(migrated.deliveries, legacy.deliveries);
    await save('B');
    const updatedNotice = (await readSource(reportPath, root, job)).notices[0]!;
    assert.equal(updatedNotice.fetchedAt, oldNotice.fetchedAt);
    assert.ok(updatedNotice.attachments[0]!.observation!.revision > 1);
    const updatedPacket = packet(updatedNotice), next = snapshot([oldPacket, updatedPacket]);
    next.sourceReport = reportPath; next.reportHash = sha256(report);
    assert.deepEqual(next.projects[0]!.currentNoticeVersions, [updatedNotice.version]);
    await saveSnapshot(root, next); await importResult(root, next, modelResult(updatedPacket));
    const updated = await executePreview(root, notifyTestConfig, 'diagnostic', async () => next, { now: clock });
    assert.equal(updated.deliveries.filter(d => d.type === 'project-update').length, 1);
    const repeated = await executePreview(root, notifyTestConfig, 'diagnostic', async () => next, { now: clock });
    assert.equal(repeated.added, 0);
    const rollback = await executePreview(root, notifyTestConfig, 'diagnostic', async () => first, { now: clock });
    assert.equal(rollback.deliveries.some(d => ['project-update', 'related-notice', 'deadline'].includes(d.type)), false);
    assert.equal((await loadLedger(root)).observations[0]!.version, updatedNotice.version);
    await save('A');
    const returnedNotice = (await readSource(reportPath, root, job)).notices[0]!;
    const returnedPacket = packet(returnedNotice), returned = snapshot([updatedPacket, returnedPacket]);
    returned.sourceReport = reportPath; returned.reportHash = sha256(report);
    assert.deepEqual(returned.projects[0]!.currentNoticeVersions, [returnedNotice.version]);
    await saveSnapshot(root, returned); await importResult(root, returned, modelResult(returnedPacket));
    const revised = await executePreview(root, notifyTestConfig, 'diagnostic', async () => returned, { now: clock });
    assert.equal(revised.deliveries.filter(d => d.type === 'project-update').length, 1);
    await executePreview(root, notifyTestConfig, 'diagnostic', async () => next, { now: clock });
    assert.equal((await loadLedger(root)).observations[0]!.version, returnedNotice.version);
  } finally { store.close(); }
});

test('历史字段和分析仍可读，但新通知不能沿用错误的截止时间；P5 schema 一致', async () => {
  const n = tender('legacy-date', '提交投标文件截止时间：详见采购文件\n开标时间：2026年09月25日18:00:00').notice;
  n.fields.dates.unshift({ kind: 'response-deadline', raw: '2026年09月25日18:00:00', evidence: '提交投标文件截止时间：详见采购文件 开标时间：2026年09月25日18:00:00' });
  const p = packet(n), f = await notifyFixture([p]);
  const loaded = await loadSnapshot(f.root, f.value.id);
  assert.equal(loaded.packets[0]!.inputHash, p.inputHash);
  assert.equal((await readResults(f.root, loaded)).size, 1);
  const run = await executePreview(f.root, f.config, 'diagnostic', async () => loaded, { now: clock });
  assert.equal(run.deliveries.some(d => d.type === 'deadline'), false);
  assert.deepEqual(JSON.parse(await readFile('schemas/notification-ledger.schema.json', 'utf8')), { $schema: 'https://json-schema.org/draft/2020-12/schema', ...ledgerContract.schema });
});
