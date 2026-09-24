import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ArchiveStore, backupArchive, restoreArchive } from '../../src/store/archive-store.js';
import { initializeRoot, sha256 } from '../../src/store/files.js';
import { parseFile } from '../../src/archive/parse-file.js';
import { importFile, runArchive } from '../../src/archive/run.js';
import { fixtureRoot, testConfig, syntheticCandidate, syntheticPdf } from './archive-fixtures.js';

test('人工附件来源待复核在恢复、跨任务复用和备份恢复后保留；显式文件导入可替换', async () => {
  const root = await fixtureRoot(); await initializeRoot(root, false);
  const store = new ArchiveStore(root), config = testConfig(root), signal = new AbortController().signal;
  try {
    const candidate = syntheticCandidate(), job = await store.createJob([candidate], 'synthetic');
    const item = store.items(job)[0]!, bytes = syntheticPdf(), parsed = await parseFile(bytes, config);
    await store.save(item, bytes, parsed, 'https://example.invalid/unconfirmed.pdf', 'manual-browser-download-review-required', true);
    for (const id of [job, await store.createJob([candidate], 'synthetic-repeat')]) {
      assert.equal((await runArchive(store, id, config, signal)).status, 'partial');
      assert.equal(store.items(id)[0]!.reason, 'MANUAL_DOWNLOAD_SOURCE_REQUIRES_REVIEW');
      assert.equal(store.items(id)[0]!.sourceReviewRequired, true);
    }
    const backup = await backupArchive(store), restored = join(root, 'restored');
    assert.equal((await restoreArchive(backup.path, restored)).ok, true);
    const copy = new ArchiveStore(restored);
    try { assert.equal((await runArchive(copy, job, testConfig(restored), signal)).status, 'partial'); } finally { copy.close(); }
    const manualPath = join(root, 'checked.pdf'); await writeFile(manualPath, bytes);
    assert.equal((await importFile(store, job, item.id, manualPath, config, signal)).status, 'complete');
    assert.equal((await store.reusable(candidate.attachmentId))!.sourceReviewRequired, false);
  } finally { store.close(); }
});

test('A→B→A 刷新按最新观察复用 A，历史和观察序号随备份恢复保留', async () => {
  const root = await fixtureRoot(); await initializeRoot(root, false); const store = new ArchiveStore(root);
  try {
    const candidate = syntheticCandidate(), job = await store.createJob([candidate], 'synthetic');
    const item = store.items(job)[0]!, a = syntheticPdf(), b = Buffer.concat([a, Buffer.from('\n% synthetic B')]);
    const revisions: number[] = [];
    for (const bytes of [a, b, a]) {
      await store.save(item, bytes, await parseFile(bytes, testConfig(root)), candidate.url, 'synthetic-refresh');
      revisions.push(item.observation!.revision);
    }
    assert.deepEqual(revisions, [1, 2, 3]);
    assert.equal((await store.reusable(candidate.attachmentId))!.sha256, sha256(a));
    assert.equal(store.db.prepare('SELECT count(*) n FROM links').get()!.n, 2);
    assert.equal(store.db.prepare('SELECT count(*) n FROM observations').get()!.n, 3);
    const backup = await backupArchive(store), target = join(root, 'restored'); await restoreArchive(backup.path, target);
    const restored = new ArchiveStore(target);
    try { assert.deepEqual(await restored.reusable(candidate.attachmentId), await store.reusable(candidate.attachmentId)); } finally { restored.close(); }
  } finally { store.close(); }
});

test('schema 1 历史人工待复核项升级后仍不可被提升为完整', async () => {
  const root = await fixtureRoot(); await initializeRoot(root, false); let store = new ArchiveStore(root);
  const candidate = syntheticCandidate(), job = await store.createJob([candidate], 'synthetic');
  const item = store.items(job)[0]!, bytes = syntheticPdf();
  await store.save(item, bytes, await parseFile(bytes, testConfig(root)), candidate.url, 'manual-browser-download-review-required');
  delete item.sourceReviewRequired; delete item.observation; store.update(item);
  store.db.exec('DROP TABLE observations; DROP TABLE archive_meta; PRAGMA user_version=1;'); store.close();
  store = new ArchiveStore(root);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 2);
    assert.equal((await runArchive(store, job, testConfig(root), new AbortController().signal)).status, 'partial');
    assert.equal((await store.verify()).ok, true);
  } finally { store.close(); }
});
