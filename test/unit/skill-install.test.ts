import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const project = process.cwd();
const installer = resolve('integrations/codex/install-skill.ps1');
const ps = (file: string, args: string[]) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
  { cwd: resolve(project, '..'), encoding: 'utf8', timeout: 45000 });
async function folder() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'p4 install synthetic '));
}

test('P4 技能在含空格路径安装、重复安装、任意目录调用和独立卸载', { skip: process.platform !== 'win32' }, async () => {
  const parent = await folder(); const dest = join(parent, 'tender-assistant');
  const unrelated = join(parent, 'user.txt'); await writeFile(unrelated, 'preserve');
  const first = ps(installer, ['-Destination', dest]); assert.equal(first.status, 0, first.stderr);
  assert.equal(ps(installer, ['-Destination', dest]).status, 0);
  assert.equal(JSON.parse(await readFile(join(dest, 'project.json'), 'utf8')).projectRoot, project);
  const wrapper = join(dest, 'scripts/tender.ps1');
  const doctor = ps(wrapper, ['doctor']); assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ready, true);
  const help = ps(wrapper, ['analyze', '--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /--prepare/);
  const error = ps(wrapper, ['analyze', '--bad-p4-test']); assert.notEqual(error.status, 0);
  const removed = ps(installer, ['-Destination', dest, '-Uninstall']); assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(access(dest)); assert.equal(await readFile(unrelated, 'utf8'), 'preserve');
});

test('P4 安装器保护已有技能、修改文件和新增文件，不删除外部文件', { skip: process.platform !== 'win32' }, async () => {
  const dest = join(await folder(), 'tender-assistant'); await mkdir(dest);
  const userFile = join(dest, 'SKILL.md'); await writeFile(userFile, 'user-owned');
  const refused = ps(installer, ['-Destination', dest]); assert.equal(refused.status, 1);
  assert.equal(await readFile(userFile, 'utf8'), 'user-owned');
  const owned = join(await folder(), 'tender-assistant'); assert.equal(ps(installer, ['-Destination', owned]).status, 0);
  const file = join(owned, 'SKILL.md'); const original = await readFile(file);
  await writeFile(file, 'local change');
  assert.equal(ps(installer, ['-Destination', owned]).status, 1);
  assert.equal(ps(installer, ['-Destination', owned, '-Uninstall']).status, 1);
  assert.equal(await readFile(file, 'utf8'), 'local change');
  await writeFile(file, original); const extra = join(owned, 'user-note.txt'); await writeFile(extra, 'keep');
  assert.equal(ps(installer, ['-Destination', owned, '-Uninstall']).status, 1);
  assert.equal(await readFile(extra, 'utf8'), 'keep');
});
