import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { acquireLock, initializeRoot } from '../../src/store/files.js';
import { fixtureRoot } from './archive-fixtures.js';

test('P5 CLI 配置关闭外发和调度，所有写入口共用锁；无快照留下失败记录，错误参数拒绝', async () => {
  const fixture = await fixtureRoot(); const project = join(fixture, 'project'), data = join(fixture, 'data');
  await mkdir(project); await cp('dist/src', join(project, 'dist/src'), { recursive: true });
  await cp('config', join(project, 'config'), { recursive: true }); await writeFile(join(project, 'package.json'), '{"type":"module"}');
  const p2 = JSON.parse(await readFile('config/p2.json', 'utf8')); p2.runtimeRoot = data;
  await writeFile(join(project, 'config/p2.json'), JSON.stringify(p2)); await initializeRoot(data, false);
  const run = (path: string, args: string[]) => spawnSync(process.execPath, [join(project, 'dist/src', path), ...args], { cwd: fixture, encoding: 'utf8', timeout: 15000 });
  const release = await acquireLock(data);
  try {
    assert.equal(run('notify/cli.js', ['--preview']).status, 1);
    const collected = run('cli.js', ['--site', 'ccgp', '--max-pages', '1', '--max-details', '1']);
    assert.equal(collected.status, 1); assert.match(collected.stderr, /仍在运行/);
  } finally { await release(); }
  const empty = run('notify/cli.js', ['--preview']); assert.equal(empty.status, 1, empty.stderr);
  assert.equal(JSON.parse(empty.stdout).errorCode, 'NO_ANALYSIS_RUN');
  const status = run('assistant/cli.js', ['notify', '--status']); assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).recentRuns[0].status, 'failed');
  assert.equal(run('notify/cli.js', ['--preview', '--send']).status, 1);
  assert.equal(run('notify/cli.js', ['--preview', '--schedule']).status, 1);
  assert.equal(run('notify/cli.js', ['--preview', '--status']).status, 1);
  const configPath = join(project, 'config/p5.json'); const config = JSON.parse(await readFile(configPath, 'utf8'));
  for (const key of ['externalSendingEnabled', 'scheduleEnabled']) {
    await writeFile(configPath, JSON.stringify({ ...config, [key]: true }));
    const rejected = run('notify/cli.js', ['--preview']); assert.equal(rejected.status, 1); assert.match(rejected.stderr, /P5_PREVIEW_ONLY/);
  }
});
