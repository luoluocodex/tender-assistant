import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access, cp, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const project = process.cwd();
const installer = resolve('integrations/codex/install-skill.ps1');
const ps = (file: string, args: string[]) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
  { cwd: resolve(project, '..'), encoding: 'utf8', timeout: 45000 });
async function folder() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'p4 install synthetic '));
}

async function isolatedProject(parent: string): Promise<string> {
  const target = join(parent, 'project'); await mkdir(target);
  for (const path of ['src', 'config', 'prompts', 'schemas', 'skills', 'integrations', 'package.json', 'tsconfig.json'])
    await cp(join(project, path), join(target, path), { recursive: true });
  // 包装器会编译：输出必须隔离，不能在其它并行测试读取 dist 时截断这些文件。
  await symlink(join(project, 'node_modules'), join(target, 'node_modules'), 'junction');
  return target;
}

test('P4 技能在含空格路径安装、重复安装、任意目录调用和独立卸载', { skip: process.platform !== 'win32' }, async () => {
  const parent = await folder(); const dest = join(parent, 'tender-assistant');
  const isolated = await isolatedProject(parent); const isolatedInstaller = join(isolated, 'integrations/codex/install-skill.ps1');
  const unrelated = join(parent, 'user.txt'); await writeFile(unrelated, 'preserve');
  const first = ps(isolatedInstaller, ['-Destination', dest]); assert.equal(first.status, 0, first.stderr);
  assert.equal(ps(isolatedInstaller, ['-Destination', dest]).status, 0);
  assert.equal(JSON.parse(await readFile(join(dest, 'project.json'), 'utf8')).projectRoot, isolated);
  const wrapper = join(dest, 'scripts/tender.ps1');
  const doctor = ps(wrapper, ['doctor']); assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ready, true);
  const help = ps(wrapper, ['analyze', '--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /--prepare/);
  const error = ps(wrapper, ['analyze', '--bad-p4-test']); assert.notEqual(error.status, 0);
  const removed = ps(isolatedInstaller, ['-Destination', dest, '-Uninstall']); assert.equal(removed.status, 0, removed.stderr);
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
