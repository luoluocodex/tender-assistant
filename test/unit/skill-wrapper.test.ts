import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, writeFile, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function fixture() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'wrapper 合成 '));
  for (const dir of ['skill/scripts', 'node_modules/typescript/bin', 'dist/src/assistant']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tender-assistant', type: 'module' }));
  await writeFile(join(root, 'skill/project.json'), JSON.stringify({ schemaVersion: 1, projectRoot: root, nodeExecutable: process.execPath }));
  await writeFile(join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);');
  await cp(resolve('skills/tender-assistant/scripts/tender.ps1'), join(root, 'skill/scripts/tender.ps1'));
  const entry = join(root, 'dist/src/assistant/cli.js');
  const run = (args: string[]) => spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-File', join(root, 'skill/scripts/tender.ps1'), ...args], { encoding: 'utf8', timeout: 20000 });
  const log = async (name: string) => (await readFile(join(root, name), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { root, entry, run, log };
}

test('包装器保存中文双流和参数边界，stderr 警告不改变成功退出码', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  await writeFile(f.entry, 'process.stderr.write("合成警告".repeat(20000)); process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const args = ['collect', '--synthetic', '中文 "引号" C:\\目录\\'];
  const result = f.run(['-LogFile', join(f.root, 'success.jsonl'), ...args]);
  assert.equal(result.status, 0, result.stderr);
  const records = await f.log('success.jsonl');
  assert.deepEqual(JSON.parse(records.find(r => r.stage === 'collect' && r.stream === 'stdout').text), args);
  assert.equal(records.find(r => r.stage === 'collect' && r.stream === 'stderr').text, '合成警告'.repeat(20000));
  assert.equal(records.at(-1).exitCode, 0);
});

test('动作错误和部分完成保留退出码；doctor 失败仍保存检查 JSON；拒绝覆盖先于业务动作', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  await writeFile(f.entry, 'process.stdout.write(JSON.stringify({ready:false})); process.stderr.write("合成失败原因"); process.exitCode=2;');
  const output = join(f.root, 'doctor.json');
  assert.equal(f.run(['-OutputFile', output, '-LogFile', join(f.root, 'doctor.jsonl'), 'doctor']).status, 2);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).ready, false);
  assert.equal((await f.log('doctor.jsonl')).at(-1).exitCode, 2);
  const noOutput = join(f.root, 'failed-results.json');
  assert.equal(f.run(['-OutputFile', noOutput, 'results']).status, 2);
  await assert.rejects(access(noOutput));
  assert.equal(f.run(['-LogFile', join(f.root, 'partial.jsonl'), 'collect']).status, 2);
  await writeFile(f.entry, 'import fs from "node:fs"; fs.writeFileSync(new URL("./must-not-run",import.meta.url),"bad");');
  assert.equal(f.run(['-LogFile', join(f.root, 'partial.jsonl'), 'collect']).status, 1);
  await assert.rejects(access(join(f.root, 'dist/src/assistant/must-not-run')));
  assert.equal((await f.log('partial.jsonl')).at(-1).exitCode, 2);
});

test('包装器启动前错误和编译失败也留下可读日志', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'node_modules/typescript/bin/tsc'), 'process.stderr.write("synthetic compile failure"); process.exitCode=3;');
  assert.equal(f.run(['-LogFile', join(f.root, 'build.jsonl'), 'doctor']).status, 3);
  const records = await f.log('build.jsonl');
  assert.match(records.find(r => r.stage === 'build' && r.stream === 'stderr').text, /compile failure/);
  assert.equal(records.at(-1).exitCode, 3);
  await writeFile(join(f.root, 'skill/project.json'), JSON.stringify({ schemaVersion: 999 }));
  assert.equal(f.run(['-LogFile', join(f.root, 'binding.jsonl'), 'collect']).status, 1);
  assert.match((await f.log('binding.jsonl')).find(r => r.stream === 'stderr').text, /Invalid skill project binding/);
});
