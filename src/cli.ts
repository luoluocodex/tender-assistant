import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './run/config.js';
import { collect } from './run/collect.js';
import { archiveConfig } from './archive/config.js';
import { acquireLock, initializeRoot } from './store/files.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, diagnostic: { type: 'boolean' },
    keyword: { type: 'string' }, site: { type: 'string', default: 'both' },
    'max-pages': { type: 'string' }, 'max-details': { type: 'string' },
  }, strict: true });
  if (values.help) console.log('P1: pnpm collect:p1 [--site both|ccgp|guangdong] [--max-pages N] [--max-details N]\n诊断：增加 --diagnostic --keyword 软件；正式运行关键词仅来自已确认配置。');
  else {
    if (!['both', 'ccgp', 'guangdong'].includes(values.site!)) throw new Error('未知 --site');
    if (values.keyword && !values.diagnostic) throw new Error('修改关键词必须显式使用 --diagnostic；正式范围请先更新已确认配置');
    const config = await loadConfig(root);
    if (values.diagnostic) {
      if (!values.keyword?.trim()) throw new Error('诊断运行必须显式给出 --keyword');
      config.keyword = values.keyword.trim();
    }
    for (const [arg, key] of [['max-pages', 'maxPages'], ['max-details', 'maxDetailsPerSite']] as const) {
      if (values[arg] !== undefined) {
        const value = Number(values[arg]);
        if (!Number.isInteger(value) || value < 1 || value > config[key]) throw new Error(`${arg} 只能在配置上限内取正整数`);
        config[key] = value;
      }
    }
    const archive = await archiveConfig(root);
    await initializeRoot(archive.runtimeRoot);
    const release = await acquireLock(archive.runtimeRoot);
    try {
      const result = await collect(config, values.diagnostic ? 'diagnostic' : 'formal', values.site!);
      console.log(JSON.stringify(result));
      process.exitCode = result.exitCode;
    } finally { await release(); }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
