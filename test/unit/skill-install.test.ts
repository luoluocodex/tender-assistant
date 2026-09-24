import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access, cp, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const project = process.cwd();
const ps = (file: string, args: string[], env = process.env) => spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
  { cwd: resolve(project, '..'), encoding: 'utf8', timeout: 45000, env });
async function folder() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'p4 install synthetic '));
}

async function isolatedProject(parent: string): Promise<string> {
  const target = join(parent, 'project'); await mkdir(target);
  for (const path of ['src', 'config', 'prompts', 'schemas', 'skills', 'integrations', 'package.json', 'tsconfig.json'])
    await cp(join(project, path), join(target, path), { recursive: true });
  // 合成项目固定中文关键词，用户对正式配置的调整不影响安装测试。
  const baselinePath = join(target, 'config/p0-baseline.json');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')); baseline.business.keywords = ['网站开发'];
  await writeFile(baselinePath, JSON.stringify(baseline));
  // 包装器会编译：输出必须隔离，不能在其它并行测试读取 dist 时截断这些文件。
  await symlink(join(project, 'node_modules'), join(target, 'node_modules'), 'junction');
  return target;
}

for (const host of ['codex', 'workbuddy']) {
  const installer = resolve(`integrations/${host}/install-skill.ps1`);
  test(`${host} 技能在含空格路径安装、重复安装、任意目录调用和独立卸载`, { skip: process.platform !== 'win32' }, async () => {
    const parent = await folder(); const dest = join(parent, 'tender-assistant');
    const isolated = await isolatedProject(parent); const isolatedInstaller = join(isolated, `integrations/${host}/install-skill.ps1`);
    const unrelated = join(parent, 'user.txt'); await writeFile(unrelated, 'preserve');
    const first = ps(isolatedInstaller, ['-Destination', dest]); assert.equal(first.status, 0, first.stderr);
    assert.equal(ps(isolatedInstaller, ['-Destination', dest]).status, 0);
    assert.equal(JSON.parse(await readFile(join(dest, 'project.json'), 'utf8')).projectRoot, isolated);
    assert.equal(JSON.parse(await readFile(join(dest, 'project.json'), 'utf8')).targetHost, host);
    if (host === 'workbuddy') await assert.rejects(access(join(dest, 'agents/openai.yaml')));
    else await access(join(dest, 'agents/openai.yaml'));
    const wrapper = join(dest, 'scripts/tender.ps1');
    const doctor = ps(wrapper, ['doctor']); assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).ready, true);
    // Host PATH may omit the system Node entirely; the installed binding must still work.
    const output = join(parent, 'doctor 中文.json');
    const noNodePath = { ...process.env, PATH: join(process.env.SystemRoot ?? 'C:/Windows', 'System32') };
    const captured = ps(wrapper, ['-OutputFile', output, 'doctor'], noNodePath);
    assert.equal(captured.status, 0, captured.stderr);
    const recorded = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(recorded.ready, true); assert.equal(recorded.baseline.business.keywords[0], '网站开发');
    const before = await readFile(output);
    assert.equal(ps(wrapper, ['-OutputFile', output, 'doctor']).status, 1);
    assert.deepEqual(await readFile(output), before);
    const failedOutput = join(parent, 'failed.json');
    assert.equal(ps(wrapper, ['-OutputFile', failedOutput, 'results', '--bad-option']).status, 1);
    await assert.rejects(access(failedOutput));
    assert.equal(ps(wrapper, ['-OutputFile', failedOutput, 'collect', '--help']).status, 1);
    const help = ps(wrapper, ['analyze', '--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /--prepare/);
    const collectHelp = ps(wrapper, ['collect', '--help']); assert.equal(collectHelp.status, 0, collectHelp.stderr); assert.match(collectHelp.stdout, /--days/);
    const overLimit = ps(wrapper, ['collect', '--days', '91']); assert.equal(overLimit.status, 1); assert.match(overLimit.stderr, /QUERY_DAYS_EXCEEDED/);
    const error = ps(wrapper, ['analyze', '--bad-p4-test']); assert.notEqual(error.status, 0);
    const removed = ps(isolatedInstaller, ['-Destination', dest, '-Uninstall']); assert.equal(removed.status, 0, removed.stderr);
    await assert.rejects(access(dest)); assert.equal(await readFile(unrelated, 'utf8'), 'preserve');
  });

  test(`${host} 安装器保护已有技能、修改文件和新增文件，不删除外部文件`, { skip: process.platform !== 'win32' }, async () => {
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
}

test('安装器兼容旧 Codex 清单并拒绝跨宿主覆盖', { skip: process.platform !== 'win32' }, async () => {
  const dest = join(await folder(), 'tender-assistant');
  const codex = resolve('integrations/codex/install-skill.ps1');
  const workbuddy = resolve('integrations/workbuddy/install-skill.ps1');
  assert.equal(ps(codex, ['-Destination', dest]).status, 0);
  const manifestPath = join(dest, '.install-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); delete manifest.targetHost;
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.equal(ps(codex, ['-Destination', dest]).status, 0);
  const original = await readFile(join(dest, 'SKILL.md'), 'utf8');
  assert.equal(ps(workbuddy, ['-Destination', dest]).status, 1);
  assert.equal(ps(workbuddy, ['-Destination', dest, '-Uninstall']).status, 1);
  assert.equal(await readFile(join(dest, 'SKILL.md'), 'utf8'), original);
});

test('安装器拒绝不可用的 Node，保持已有安装不变', { skip: process.platform !== 'win32' }, async () => {
  const parent = await folder(); const dest = join(parent, 'tender-assistant');
  const installer = resolve('integrations/workbuddy/install-skill.ps1');
  assert.equal(ps(installer, ['-Destination', dest]).status, 0);
  const before = await readFile(join(dest, 'project.json'));
  assert.equal(ps(installer, ['-Destination', dest, '-NodeExecutable', join(parent, 'missing-node.exe')]).status, 1);
  assert.deepEqual(await readFile(join(dest, 'project.json')), before);
});
