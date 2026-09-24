import { acquireLock } from '../../src/store/files.js';

let release: (() => Promise<void>) | undefined;
process.on('message', async (message: unknown) => {
  if (message === 'start') {
    try { release = await acquireLock(process.argv[2]!); process.send?.('acquired'); }
    catch { process.send?.('blocked'); process.disconnect(); }
  } else if (message === 'release') {
    await release?.(); process.disconnect();
  }
});
process.send?.('ready');
