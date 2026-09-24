import { Worker } from 'node:worker_threads';
import type { ArchiveConfig, ParsedFile } from './model.js';
import { fileKind } from './parse-file.js';

/** 将不可信文件解析放在可终止的工作线程，超时/取消不阻塞采集队列。 */
export async function parseIsolated(bytes: Buffer, config: ArchiveConfig, signal: AbortSignal): Promise<ParsedFile> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse-worker.js', import.meta.url), { workerData: { bytes, config }, resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true });
    worker.stdout?.resume(); worker.stderr?.resume();
    let finished = false;
    const finish = (result?: ParsedFile, error?: unknown): void => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      void worker.terminate().finally(() => { if (error) reject(error); else resolve(result!); });
    };
    const fallback = (status: 'timeout' | 'invalid', reason: string): ParsedFile => ({ parserVersion: 'p2-v2', kind: fileKind(bytes), status, reason, units: [], members: [] });
    const abort = (): void => finish(undefined, signal.reason ?? new Error('取消'));
    const timer = setTimeout(() => finish(fallback('timeout', 'PARSER_TIMEOUT')), config.parseTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (result: ParsedFile) => finish(result));
    worker.once('error', () => finish(fallback('invalid', 'PARSER_WORKER_ERROR')));
    worker.once('exit', code => { if (!finished) finish(fallback('invalid', `PARSER_EXIT_${code}`)); });
  });
}
