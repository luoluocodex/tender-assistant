import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, writeFile, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function fixture() {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'wrapper 合成 '));
  for (const dir of ['skill/scripts', 'node_modules/typescript/bin', 'dist/src/assistant']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tender-assistant', type: 'module' }));
  await writeFile(join(root, 'skill/project.json'), JSON.stringify({ schemaVersion: 1, projectRoot: root, nodeExecutable: process.execPath }));
  await writeFile(join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);');
  await cp(resolve('skills/tender-assistant/scripts'), join(root, 'skill/scripts'), { recursive: true });
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
  const output = join(f.root, 'stdout.txt'), error = join(f.root, 'stderr.txt');
  const result = f.run(['-LogFile', join(f.root, 'success.jsonl'), '-OutputFile', output, '-ErrorFile', error, ...args]);
  assert.equal(result.status, 0, result.stderr);
  const records = await f.log('success.jsonl');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), args);
  assert.equal(await readFile(error, 'utf8'), '合成警告'.repeat(20000));
  assert.equal(records.find(r => r.stage === 'collect' && r.stream === 'stderr').charCount, 80000);
  assert.doesNotMatch(await readFile(join(f.root, 'success.jsonl'), 'utf8'), /合成警告|中文/);
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
  const partial = join(f.root, 'partial.txt');
  assert.equal(f.run(['-LogFile', join(f.root, 'partial.jsonl'), '-OutputFile', partial, 'collect']).status, 2);
  assert.equal(JSON.parse(await readFile(partial, 'utf8')).ready, false);
  await writeFile(f.entry, 'import fs from "node:fs"; fs.writeFileSync(new URL("./must-not-run",import.meta.url),"bad");');
  assert.equal(f.run(['-LogFile', join(f.root, 'partial.jsonl'), 'collect']).status, 1);
  await assert.rejects(access(join(f.root, 'dist/src/assistant/must-not-run')));
  assert.equal((await f.log('partial.jsonl')).at(-1).exitCode, 2);
});

test('包装器启动前错误和编译失败也留下可读日志', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'node_modules/typescript/bin/tsc'), 'process.stderr.write("synthetic compile failure"); process.exitCode=3;');
  const error = join(f.root, 'build-error.txt');
  assert.equal(f.run(['-LogFile', join(f.root, 'build.jsonl'), '-ErrorFile', error, 'doctor']).status, 3);
  const records = await f.log('build.jsonl');
  assert.match(await readFile(error, 'utf8'), /compile failure/);
  assert.equal(records.find(r => r.stage === 'build' && r.stream === 'stderr').text, 'captured');
  assert.equal(records.at(-1).exitCode, 3);
  await writeFile(join(f.root, 'skill/project.json'), JSON.stringify({ schemaVersion: 999 }));
  const bindingError = join(f.root, 'binding-error.txt');
  assert.equal(f.run(['-LogFile', join(f.root, 'binding.jsonl'), '-ErrorFile', bindingError, 'collect']).status, 1);
  assert.match(await readFile(bindingError, 'utf8'), /Invalid skill project binding/);
  assert.equal((await f.log('binding.jsonl')).at(-1).exitCode, 1);
});

test('人工接管在进程结束前显示无换行提示、记录事件并接收 done/cancel', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  await writeFile(f.entry, `import {createInterface} from 'node:readline/promises';
console.log(JSON.stringify({event:'human-handoff',instruction:'untrusted event payload'}));
const terminal=createInterface({input:process.stdin,output:process.stdout});
try { const answer=await terminal.question('TYPE done: ',{signal:AbortSignal.timeout(10000)});
console.log('ANSWER='+answer); process.exitCode=answer==='done'?0:130;
} finally {terminal.close();}`);
  for (const answer of ['done', 'cancel']) {
    const log = join(f.root, `${answer}.jsonl`);
    const ps = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(ps, ['-NoProfile', '-File', join(f.root, 'skill/scripts/tender.ps1'), '-LogFile', log, 'archive', '--auth', 'synthetic'], { timeout: 15000 });
    let out = '', err = '', sent = false, liveLog = '';
    let sendTask: Promise<void> | undefined;
    child.stdout.on('data', chunk => {
      out += chunk.toString('utf8');
      if (!sent && out.includes('TYPE done: ')) {
        sent = true;
        sendTask = readFile(log, 'utf8').then(text => { liveLog = text; child.stdin.end(answer + '\n'); });
      }
    });
    child.stderr.on('data', chunk => { err += chunk.toString('utf8'); });
    const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    await sendTask;
    assert.equal(code, answer === 'done' ? 0 : 130, err);
    assert.equal(sent, true); assert.match(out, new RegExp('ANSWER=' + answer));
    assert.match(liveLog, /needs-human/); assert.doesNotMatch(liveLog, /untrusted event payload/);
    assert.equal((await f.log(`${answer}.jsonl`)).at(-1).exitCode, code);
  }
});

test('原始证据和签名只进入受限结果文件，普通日志不复制任何原始双流', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  const payload = { sourceUrl: 'https://example.invalid?token=TEST_TOKEN&signature=TEST_SIGNATURE', prompts: { relevance: 'TEST_PROMPT' }, items: [{ text: 'TEST_EVIDENCE' }] };
  await writeFile(f.entry, `console.log(${JSON.stringify(JSON.stringify(payload))}); console.error('TEST_SECRET_IN_ERROR');`);
  const output = join(f.root, 'packet.json'), error = join(f.root, 'error.txt'), log = join(f.root, 'metadata.jsonl');
  assert.equal(f.run(['-OutputFile', output, '-ErrorFile', error, '-LogFile', log, 'packet']).status, 0);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), payload);
  assert.match(await readFile(error, 'utf8'), /TEST_SECRET_IN_ERROR/);
  assert.doesNotMatch(await readFile(log, 'utf8'), /TEST_|example\.invalid|sourceUrl|prompts/);
  const ps = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const file of [output, error]) {
    const acl = spawnSync(ps, ['-NoProfile', '-Command', `$acl=[IO.File]::GetAccessControl('${file.replaceAll("'", "''")}'); @{protected=$acl.AreAccessRulesProtected;sids=@($acl.Access | ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value});current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress`], { encoding: 'utf8' });
    assert.equal(acl.status, 0, acl.stderr);
    const value = JSON.parse(acl.stdout); assert.equal(value.protected, true);
    assert.deepEqual(value.sids.sort(), [value.current, 'S-1-5-18'].sort());
  }
  // 路径碰撞必须先于写入动作，不能覆盖已有输出或执行业务。
  await writeFile(f.entry, `throw new Error('MUST_NOT_RUN');`);
  assert.equal(f.run(['-OutputFile', output, 'collect']).status, 1);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), payload);
});
