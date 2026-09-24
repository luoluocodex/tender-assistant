import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireLock } from '../../src/store/files.js';
import { fixtureRoot } from './archive-fixtures.js';

function worker(root: string) {
  const child = fork(new URL('./store-lock-worker.js', import.meta.url), [root], { silent: true, windowsHide: true });
  child.stdout!.resume(); child.stderr!.resume();
  const ready = new Promise<void>(resolve => child.on('message', message => { if (message === 'ready') resolve(); }));
  const result = new Promise<unknown>(resolve => child.on('message', message => { if (message !== 'ready') resolve(message); }));
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  return { child, ready, result, exited };
}

test('遗留锁并发回收只允许一个持锁者，崩溃后可恢复且不删除互斥数据库', { timeout: 20000 }, async () => {
  const root = await fixtureRoot();
  const crashed = worker(root);
  await crashed.ready; crashed.child.send('start'); assert.equal(await crashed.result, 'acquired');
  crashed.child.kill(); await crashed.exited;
  // 复用真实退出的持锁 PID，不依赖机器上某个猜测的 PID。
  for (let round = 0; round < 3; round++) {
    await writeFile(join(root, 'archive.lock'), JSON.stringify({ pid: crashed.child.pid, token: 'synthetic-crashed-owner' }));
    const contenders = Array.from({ length: 8 }, () => worker(root));
    try {
      await Promise.all(contenders.map(w => w.ready)); contenders.forEach(w => w.child.send('start'));
      const outcomes = await Promise.all(contenders.map(w => w.result));
      assert.equal(outcomes.filter(r => r === 'acquired').length, 1);
      contenders.forEach((w, i) => { if (outcomes[i] === 'acquired') w.child.send('release'); });
      await Promise.all(contenders.map(w => w.exited));
    } finally {
      for (const w of contenders) if (w.child.exitCode === null) w.child.kill();
      await Promise.all(contenders.map(w => w.exited));
    }
  }
  const release = await acquireLock(root); await release(); await release();
  await access(join(root, 'archive.lock.sqlite'));
});
