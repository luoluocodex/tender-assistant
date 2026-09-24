import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { archiveConfig } from '../archive/config.js';
import { json } from '../analysis/persistence.js';
import { selectSnapshot } from './catalog.js';
import { resultView, queueView, packetView } from './views.js';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const help = `招投标助手 P4 统一入口
  doctor                                  检查本地运行条件，不登录或采集
  results [--purpose formal|diagnostic] [--run p3-id] [--offset 0] [--limit 10]
  queue   [同上]                           列出适合继续分析的待办
  packet  --run p3-id --packet packet-id [--purpose ...] [--offset 0] [--limit 3]
  collect <P1参数>                         例：collect --days 3 --site ccgp；天数 1～90
  archive <P2参数>                         例：archive --verify
  analyze <P3参数>                         例：analyze --prepare --report <绝对路径>
  notify  <P5参数>                         例：notify --preview 或 notify --status
collect/archive/analyze/notify 使用 --help 查看各自参数；退出码保留原程序定义。
默认读取最新正式 P3 快照，零结果或没有快照不切换诊断用途，不自动联网。
这是已有快照的预览；无实际通知发送、无周期任务、无真实公司匹配。`;

async function doctor() {
  const config = await archiveConfig(project);
  const required = ['node_modules/typescript/bin/tsc', 'dist/src/cli.js', 'dist/src/archive/cli.js', 'dist/src/analysis/cli.js', 'dist/src/notify/cli.js'];
  const missing: string[] = [];
  for (const file of required) { try { await access(resolve(project, file)); } catch { missing.push(file); } }
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeSupported = major > 24 || (major === 24 && minor >= 13);
  const baseline: unknown = JSON.parse(await readFile(resolve(project, 'config/p0-baseline.json'), 'utf8'));
  return { schemaVersion: 1, action: 'doctor', project, runtimeRoot: config.runtimeRoot, node: process.versions.node,
    ready: nodeSupported && missing.length === 0, missing, nodeSupported, baseline,
    checked: '仅程序文件与版本；未检查政府站点登录、联网或浏览器运行状态' };
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === '--help' || action === 'help') { process.stdout.write(help + '\n'); return; }
  const delegates: Record<string, string> = { collect: 'dist/src/cli.js', archive: 'dist/src/archive/cli.js', analyze: 'dist/src/analysis/cli.js', notify: 'dist/src/notify/cli.js' };
  if (Object.hasOwn(delegates, action)) {
    // 在同一进程执行原入口，让 Ctrl+C 和退出码继续由各阶段负责，避免 Windows 强杀子进程。
    const entry = resolve(project, delegates[action]!);
    process.chdir(project); process.argv = [process.execPath, entry, ...args];
    await import(pathToFileURL(entry).href); return;
  }
  if (!['doctor', 'results', 'queue', 'packet'].includes(action)) throw new Error('UNKNOWN_ACTION: 使用 --help');
  if (action === 'doctor') {
    if (args.length) throw new Error('DOCTOR_TAKES_NO_ARGUMENTS');
    const result = await doctor(); process.stdout.write(json(result)); process.exitCode = result.ready ? 0 : 2; return;
  }
  const { values: v } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    purpose: { type: 'string', default: 'formal' }, run: { type: 'string' }, packet: { type: 'string' },
    offset: { type: 'string', default: '0' }, limit: { type: 'string', default: action === 'packet' ? '3' : '10' },
  } });
  if (v.purpose !== 'formal' && v.purpose !== 'diagnostic') throw new Error('INVALID_PURPOSE');
  if ((action === 'packet' && (!v.packet || !v.run)) || (action !== 'packet' && v.packet)) throw new Error('PACKET_REQUIRES_RUN_AND_PACKET');
  const offset = Number(v.offset), limit = Number(v.limit);
  if (!/^\d+$/.test(v.offset) || !/^\d+$/.test(v.limit) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > (action === 'packet' ? 10 : 50)) throw new Error('INVALID_PAGE');
  const config = await archiveConfig(project);
  const snapshot = await selectSnapshot(config.runtimeRoot, v.purpose, v.run);
  const envelope = { schemaVersion: 1, action, purpose: v.purpose, status: snapshot ? 'snapshot' : 'no-analysis-run',
    runId: snapshot?.id ?? null, createdAt: snapshot?.createdAt ?? null, sourceReport: snapshot?.sourceReport ?? null, p3AcceptanceComplete: false,
    notification: 'preview-only-not-sent', limitations: ['历史快照，不代表当前可投标项目', '仍需人工复核；真实公司匹配未启用'],
    resultSchema: resolve(project, 'schemas/analysis-result.schema.json') };
  if (!snapshot) { process.stdout.write(json({ ...envelope, nextAction: '先 collect，再 analyze --prepare --report <P1报告>；没有快照不等于检索零结果' })); return; }
  const result = action === 'results' ? await resultView(config.runtimeRoot, snapshot, offset, limit)
    : action === 'queue' ? await queueView(config.runtimeRoot, snapshot, offset, limit)
      : packetView(snapshot, v.packet!, offset, limit);
  process.stdout.write(json({ ...envelope, ...result }));
}
await main().catch(error => {
  process.stderr.write(json({ action: 'assistant', status: 'error', message: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }));
  process.exitCode = 1;
});
