import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { archiveConfig, object, string } from '../archive/config.js';
import { acquireLock, atomicFile, initializeRoot, sha256 } from '../store/files.js';
import { readSource } from './source.js';
import { readPrompts, readRules, makePacket } from './packets.js';
import { associate, projectId } from './rules.js';
import { companyContract, resultContract, labelsContract } from './contract.js';
import { importResult, loadSnapshot, saveSnapshot, runPath, json, readResults } from './persistence.js';
import { evaluate, writeReport } from './report.js';
import type { AnalysisSnapshot, Notice } from './model.js';

const help = `P3 离线过滤、证据包与 Codex 会话分析（不调用付费 API）
  --prepare --report <P1报告> [--archive-job <P2任务>] [--company-fixture <合成资料>]
            [--previous <P3任务>] [--track <site:id> 可重复]
  --run <P3任务> --import <模型结果JSON对象或数组>
  --run <P3任务> --render
  --run <P3任务> --evaluate <人工或合成标注JSON>
  --schemas     生成 schemas 中的输出规范
分析输出在受控数据目录 runs/p3-*/；原公告、附件和模型结果历史保留。
公司输入目前只接受 kind=synthetic 的明确合成数据；真实公司匹配未启用。
无外部通知、无自动模型进程；成功退出仅代表本次步骤完成，不代表 P3 验收。`;

async function main(): Promise<void> {
  const { values: v } = parseArgs({ options: {
    help: { type: 'boolean' }, prepare: { type: 'boolean' }, report: { type: 'string' }, 'archive-job': { type: 'string' },
    previous: { type: 'string' }, track: { type: 'string', multiple: true }, 'company-fixture': { type: 'string' },
    run: { type: 'string' }, import: { type: 'string' }, render: { type: 'boolean' }, evaluate: { type: 'string' }, schemas: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (v.help) { process.stdout.write(help + '\n'); return; }
  const project = process.cwd();
  if ([v.prepare, v.import, v.render, v.evaluate, v.schemas].filter(Boolean).length !== 1) throw new Error('请选择且仅选择一种操作；使用 --help');
  if (!v.prepare && [v.report, v['archive-job'], v.previous, v.track, v['company-fixture']].some(Boolean)) throw new Error('准备参数不能用于导入或渲染');
  if (v.schemas) {
    for (const [name, contract] of [['analysis-result', resultContract], ['analysis-labels', labelsContract], ['company-fixture', companyContract]] as const) {
      await atomicFile(resolve(project, `schemas/${name}.schema.json`), json({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...contract.schema }));
    }
    process.stdout.write(json({ schemasGenerated: 3 })); return;
  }
  const config = await archiveConfig(project); await initializeRoot(config.runtimeRoot);
  const release = await acquireLock(config.runtimeRoot);
  try {
    if (v.prepare) {
      if (!v.report || v.run) throw new Error('--prepare 需要 --report，不能同时指定 --run');
      const source = await readSource(resolve(v.report), config.runtimeRoot, v['archive-job']);
      const rules = await readRules(project); const prompts = await readPrompts(project);
      const company = v['company-fixture'] ? companyContract.parse(JSON.parse(await readFile(resolve(v['company-fixture']), 'utf8'))) : null;
      const previous = v.previous ? await loadSnapshot(config.runtimeRoot, v.previous) : null;
      if (previous && previous.purpose !== source.purpose) throw new Error('CANNOT_MIX_FORMAL_AND_DIAGNOSTIC');
      const notices = new Map<string, Notice>();
      for (const n of [...(previous?.packets.map(p => p.notice) ?? []), ...source.notices]) notices.set(n.version, n);
      const trackedKeys = new Set([...(v.track ?? []), ...(previous?.packets.filter(p => p.decision.tracked).map(p => p.notice.key) ?? [])]);
      for (const key of trackedKeys) if (![...notices.values()].some(n => n.key === key)) throw new Error('UNKNOWN_TRACKED_NOTICE');
      const trackedProjects = new Set([...notices.values()].filter(n => trackedKeys.has(n.key)).map(projectId));
      const packets = [...notices.values()].map(n => makePacket(n, rules, prompts, company, trackedProjects.has(projectId(n))));
      const id = `p3-${sha256(json({ report: source.reportHash, packets: packets.map(p => p.inputHash) })).slice(0, 24)}`;
      let snapshot: AnalysisSnapshot;
      try { await access(resolve(runPath(config.runtimeRoot, id), 'snapshot.json')); snapshot = await loadSnapshot(config.runtimeRoot, id); }
      catch (e) {
        if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ENOENT') throw e;
        snapshot = { schemaVersion: 1, phase: 'P3', id, createdAt: new Date().toISOString(), purpose: source.purpose,
          reportHash: source.reportHash, sourceReport: resolve(v.report), rules, packets, projects: associate([...notices.values()]), p3AcceptanceComplete: false };
        await saveSnapshot(config.runtimeRoot, snapshot);
      }
      if (previous) {
        const priorResults = await readResults(config.runtimeRoot, previous);
        for (const p of snapshot.packets) {
          const result = priorResults.get(p.packetId);
          if (result) await importResult(config.runtimeRoot, snapshot, result.original);
        }
        await atomicFile(resolve(runPath(config.runtimeRoot, id), 'changes.json'), json({ previous: previous.id,
          newInputs: packets.filter(p => !previous.packets.some(old => old.inputHash === p.inputHash)).map(p => p.packetId),
          retainedInputs: packets.filter(p => previous.packets.some(old => old.inputHash === p.inputHash)).map(p => p.packetId) }));
      }
      const counts = await writeReport(config.runtimeRoot, snapshot);
      process.stdout.write(json({ id, path: runPath(config.runtimeRoot, id), counts, modelInvocation: 'manual-codex-session' })); return;
    }
    const snapshot = await loadSnapshot(config.runtimeRoot, string(v.run));
    if (v.import) {
      const raw: unknown = JSON.parse(await readFile(resolve(v.import), 'utf8')); const values = Array.isArray(raw) ? raw : [raw];
      // 逐条提交；中断后重跑复用已验证内容，未完成项不会当作已分析。
      try {
        for (const item of values) { object(item); process.stdout.write(json(await importResult(config.runtimeRoot, snapshot, item))); }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]+(?::[a-zA-Z]+)?$/.test(error.message) ? error.message : 'INVALID_RESULT';
        await atomicFile(resolve(runPath(config.runtimeRoot, snapshot.id), `rejections/${sha256(json(raw))}.json`), json({ code, inputHash: sha256(json(raw)), rejectedAt: new Date().toISOString(), originalBodyStored: false }));
        throw error;
      } finally { await writeReport(config.runtimeRoot, snapshot); }
    }
    if (v.evaluate) process.stdout.write(json(await evaluate(config.runtimeRoot, snapshot, JSON.parse(await readFile(resolve(v.evaluate), 'utf8')))));
    else process.stdout.write(json({ id: snapshot.id, counts: await writeReport(config.runtimeRoot, snapshot) }));
  } finally { await release(); }
}
main().catch(error => {
  // 校验错误只输出程序错误码，不打印模型正文或输入路径中的潜在敏感材料。
  const message = error instanceof Error ? error.message : 'UNKNOWN_ANALYSIS_ERROR';
  process.stderr.write(json({ phase: 'P3', status: 'failed', code: /^[A-Z_]+(?::[a-zA-Z]+)?$/.test(message) ? message : 'ANALYSIS_INPUT_OR_IO_ERROR', hint: '核对输入字段、版本与本地文件；参见 P3 文档' }));
  process.exitCode = 1;
});
