import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { archiveConfig } from './config.js';
import { candidates } from './source.js';
import { initializeRoot, acquireLock, inside } from '../store/files.js';
import { ArchiveStore, backupArchive, restoreArchive } from '../store/archive-store.js';
import { runArchive, importFile } from './run.js';
import { openSession, waitForManualDownload } from '../auth/session.js';
import { parseIsolated } from './parse.js';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const controller = new AbortController();
const stop = (): void => controller.abort(new Error('用户取消'));
process.once('SIGINT', stop); process.once('SIGTERM', stop);
let deadline: NodeJS.Timeout | undefined;
try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, report: { type: 'string' }, pick: { type: 'string', multiple: true }, resume: { type: 'string' },
    refresh: { type: 'boolean' }, verify: { type: 'boolean' }, backup: { type: 'boolean' }, 'restore-check': { type: 'string' },
    auth: { type: 'string' }, account: { type: 'string', default: 'default' }, session: { type: 'string' },
    'import-file': { type: 'string' }, item: { type: 'string' }, 'manual-download': { type: 'boolean' },
  }, strict: true });
  if (values.help) {
    console.log('P2: --report P1报告 --pick 公告ID:附件序号(0起，可重复) | --resume 任务ID [--refresh] [--session 来源ID]\n维护: --verify | --backup | --restore-check 备份目录\n会话: --auth 来源ID [--account 账号别名]；必须人工核验，无默认登录成功判定\n人工文件: --resume 任务ID --item 附件任务ID --import-file 文件路径\n人工浏览器下载: --resume 任务ID --item 附件任务ID --session 来源ID --manual-download');
  } else {
    const modes = [values.report, values.resume, values.verify, values.backup, values['restore-check'], values.auth].filter(Boolean);
    if (modes.length !== 1) throw new Error('必须且只能指定一个 P2 主操作');
    if (values.pick && !values.report) throw new Error('--pick 必须配合 --report');
    if ((values['import-file'] || values['manual-download']) && (!values.resume || !values.item)) throw new Error('人工导入需要 --resume 和 --item');
    if (values['manual-download'] && (!values.session || values['import-file'])) throw new Error('浏览器下载需要 --session，不能同时文件导入');
    const config = await archiveConfig(project); deadline = setTimeout(stop, config.maxRunMinutes * 60000);
    // 无效输入先被拒绝；第一次创建真实数据前已在配置与 P2 文档定义保存策略。
    const selected = values.report ? await candidates(resolve(values.report), values.pick ?? [], config) : null;
    await initializeRoot(config.runtimeRoot);
    const release = await acquireLock(config.runtimeRoot);
    let store: ArchiveStore | undefined; let session: Awaited<ReturnType<typeof openSession>> | undefined; let activeJob: string | undefined;
    try {
      store = new ArchiveStore(config.runtimeRoot);
      const sourceId = values.auth ?? values.session;
      const source = sourceId ? config.sources.find(s => s.id === sourceId) : undefined;
      if (sourceId && !source) throw new Error('未知会话来源');
      if (source) session = await openSession(config.runtimeRoot, source.origin, values.account!);
      if (values.auth && session && source) {
        const page = session.context.pages()[0] ?? await session.context.newPage();
        await page.goto(source.origin, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => {});
        await session.record('human-handoff-login-not-verified');
        console.log(JSON.stringify({ event: 'human-handoff', source: source.id, instruction: '在专用浏览器完成必要登录；返回终端输入 done 保存，或 cancel 取消。此步骤不办理报名、付费或签署。' }));
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await terminal.question('登录操作完成后输入 done：', { signal: controller.signal });
          if (answer.trim() !== 'done') { await session.record('cancelled'); process.exitCode = 130; }
          else { await session.record('saved-awaiting-protected-resource-check'); console.log('会话已保存；需要用原附件任务验证访问，尚未宣称登录成功。'); }
        } finally { terminal.close(); }
      } else if (values.verify) {
        const result = await store.verify(); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 2;
      } else if (values.backup) console.log(JSON.stringify(await backupArchive(store)));
      else if (values['restore-check']) {
        const parent = inside(config.runtimeRoot, 'restore-checks'); await mkdir(parent, { recursive: true });
        const target = inside(parent, `check-${Date.now()}`);
        const result = await restoreArchive(resolve(values['restore-check']), target);
        console.log(JSON.stringify({ target, ...result })); if (!result.ok) process.exitCode = 2;
      } else {
        const jobId = selected ? await store.createJob(selected, resolve(values.report!)) : values.resume!;
        store.job(jobId); activeJob = jobId; console.log(JSON.stringify({ event: 'archive-started', jobId }));
        if (values['import-file']) {
          const item = await importFile(store, jobId, values.item!, resolve(values['import-file']), config, controller.signal);
          console.log(JSON.stringify({ jobId, itemId: item.id, status: item.status, report: await store.report(jobId) })); if (item.status !== 'complete') process.exitCode = 2;
        } else if (values['manual-download'] && session && source) {
          const item = store.items(jobId).find(x => x.id === values.item); if (!item || new URL(item.candidate.url).origin !== source.origin) throw new Error('下载条目与会话来源不匹配');
          item.status = 'needs-human'; item.reason = 'WAITING_FOR_MANUAL_BROWSER_DOWNLOAD'; store.update(item); await store.setStatus(jobId, 'needs-human');
          const pending = waitForManualDownload(session.context, config.maxFileBytes, controller.signal);
          void pending.catch(() => {});
          const page = session.context.pages()[0] ?? await session.context.newPage();
          console.log(JSON.stringify({ event: 'human-handoff', jobId, itemId: item.id, source: source.id, name: item.candidate.name }));
          await page.goto(item.candidate.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => {});
          const downloaded = await pending;
          // 人工选择可能来自其它页面：保留其实际下载来源，不自动认定其与目标材料完全一致。
          const parsed = await parseIsolated(downloaded.bytes, config, controller.signal);
          await store.save(item, downloaded.bytes, parsed, downloaded.url, 'manual-browser-download-review-required');
          item.status = 'partial'; item.reason = 'MANUAL_DOWNLOAD_SOURCE_REQUIRES_REVIEW'; store.update(item); await store.setStatus(jobId, 'partial'); process.exitCode = 2;
          console.log(JSON.stringify({ jobId, report: await store.report(jobId), status: 'partial' }));
        } else {
          const result = await runArchive(store, jobId, config, controller.signal, { refresh: values.refresh ?? false, ...(session && source ? { session: session.context, sessionOrigin: source.origin } : {}) });
          if (session) await session.record('download-attempted-see-job-report-auth-not-assumed');
          console.log(JSON.stringify(result)); process.exitCode = result.status === 'complete' ? 0 : result.status === 'cancelled' ? 130 : 2;
        }
      }
    } catch (error) {
      if (store && activeJob) {
        if (controller.signal.aborted && values.item) {
          const item = store.items(activeJob).find(x => x.id === values.item);
          if (item) { item.status = 'cancelled'; item.reason = 'CANCELLED'; store.update(item); }
        }
        await store.setStatus(activeJob, controller.signal.aborted ? 'cancelled' : 'partial');
      }
      if (session && values.auth && controller.signal.aborted) await session.record('cancelled');
      throw error;
    } finally { try { await session?.close(); } finally { store?.close(); await release(); } }
  }
} catch (error) {
  // 不打印带查询参数的底层错误、Cookie 或解析器输出。
  const message = error instanceof Error ? error.message : '未知错误';
  console.error(message.includes('://') ? 'P2 操作失败，请检查任务记录或配置' : message);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally { clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
