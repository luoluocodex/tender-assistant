import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixtureRoot } from './archive-fixtures.js';
import { notice, modelResult } from './analysis-fixtures.js';
import { sha256 } from '../../src/store/files.js';
import { loadSnapshot, readResults, json } from '../../src/analysis/persistence.js';

test('P3 CLI 重跑稳定，关联新版本只重算受影响输入，旧模型结果拒绝且清单不虚报成功', async () => {
  const root = await fixtureRoot(); const project = resolve(root,'project'); const data = resolve(root,'data');
  await mkdir(resolve(project,'config'),{recursive:true}); await mkdir(resolve(project,'prompts'));
  const p2 = JSON.parse(await readFile('config/p2.json','utf8')); p2.runtimeRoot = data;
  await writeFile(resolve(project,'config/p2.json'),json(p2));
  await copyFile('config/p0-baseline.json',resolve(project,'config/p0-baseline.json'));
  for (const name of ['relevance','summary','qualification']) await copyFile(`prompts/${name}.md`,resolve(project,`prompts/${name}.md`));
  const cli = resolve('dist/src/analysis/cli.js');
  const run = async (...args: string[]) => (await promisify(execFile)(process.execPath,[cli,...args],{cwd:project,windowsHide:true})).stdout;
  const a = notice('a'); const b = notice('b','合成第二个采购公告','项目编号：TEST-2\n采购人：合成采购方\n具备测试资质甲级');
  const sourcePath = resolve(project,'source.json');
  const source = (values: ReturnType<typeof notice>[]) => ({phase:'P1',purpose:'diagnostic',window:a.window,
    queries:[{id:'q',status:'complete',listings:values.map(n=>n.listing),excluded:[]}],
    details:values.map(n=>({listing:n.listing,text:n.text,sha256:sha256(n.text),status:n.completeness,attachments:[],fetchedAt:n.fetchedAt}))});
  await writeFile(sourcePath,json(source([a,b])));
  const first = JSON.parse(await run('--prepare','--report',sourcePath));
  assert.equal(JSON.parse(await run('--prepare','--report',sourcePath)).id,first.id);
  const s = await loadSnapshot(data,first.id); const responsePath = resolve(project,'response.json');
  await writeFile(responsePath,json(s.packets.map(p=>modelResult(p)))); await run('--run',s.id,'--import',responsePath);
  b.text += '\n发生变更'; b.fetchedAt = '2026-09-24T10:00:00Z';
  await writeFile(sourcePath,json(source([a,b])));
  const next = JSON.parse(await run('--prepare','--report',sourcePath,'--previous',s.id));
  const updated = await loadSnapshot(data,next.id); assert.equal(updated.packets.length,3);
  assert.equal((await readResults(data,updated)).size,2); // 两份原版本分析保留，新版本等待分析。
  const rowReport = JSON.parse(await readFile(resolve(data,`runs/${next.id}/report.json`),'utf8'));
  assert.equal(rowReport.rows.filter((v: {versionState:string})=>v.versionState==='superseded').length,1);
  const newer = updated.packets.find(p=>p.notice.key===b.key && p.notice.text.includes('发生变更'))!;
  const stale = {...modelResult(newer),inputHash:'stale'};
  await writeFile(responsePath,json(stale)); await assert.rejects(run('--run',next.id,'--import',responsePath));
  assert.equal((await readResults(data,updated)).size,2);
});
