import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const project = process.cwd();
const cli = resolve('dist/src/assistant/cli.js');
const run = (args: string[], entry = cli) => spawnSync(process.execPath, [entry, ...args], { cwd: resolve(project, '..'), encoding: 'utf8', timeout: 30000 });

test('P4 任意工作目录可诊断；拒绝误拼参数、非整数分页与诊断用途混用', () => {
  const doctor = run(['doctor']); assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).project.replace(/[\\/]$/, ''), project);
  assert.equal(JSON.parse(doctor.stdout).ready, true);
  for (const args of [['unknown'], ['results', '--limt', '5'], ['queue', '--offset', '-1'], ['packet'], ['results', '--limit', '1.5'], ['results', '--purpose', 'fake'], ['doctor', '--run', 'x']]) {
    const result = run(args); assert.equal(result.status, 1, result.stdout);
    assert.equal(JSON.parse(result.stderr).status, 'error');
  }
});

test('P4 各阶段帮助与原入口一致，原阶段失败退出码不被吞掉', () => {
  const stages = { collect: 'dist/src/cli.js', archive: 'dist/src/archive/cli.js', analyze: 'dist/src/analysis/cli.js', notify: 'dist/src/notify/cli.js' };
  for (const [action, path] of Object.entries(stages)) {
    const original = run(['--help'], resolve(project, path));
    const delegated = run([action, '--help']);
    assert.equal(delegated.status, original.status); assert.equal(delegated.stdout, original.stdout);
    const rejected = run([action, '--unsupported-p4-test', 'path with spaces; echo unexpected']);
    const direct = run(['--unsupported-p4-test', 'path with spaces; echo unexpected'], resolve(project, path));
    assert.notEqual(direct.status, 0); assert.equal(rejected.status, direct.status);
  }
});

test('统一入口保留日期超限提示，不将采集拒绝包装为成功', () => {
  const result = run(['collect', '--days', '91']);
  assert.equal(result.status, 1); assert.match(result.stderr, /QUERY_DAYS_EXCEEDED.*90/);
});
