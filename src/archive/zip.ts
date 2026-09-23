import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import type { ArchiveConfig } from './model.js';
import { ArchiveError } from './model.js';

/** 不向文件系统解压，仍拒绝路径穿越、链接、加密条目及异常膨胀。 */
export function safeMember(name: string, attributes: number): boolean {
  return name.length <= 512 && !/^[\/]|^[A-Za-z]:|\\|\0|:/.test(name) && !name.split('/').some(s => s === '..' || s === '.') && ((attributes >>> 16) & 0xf000) !== 0xa000;
}

export interface ZipBudget { expanded: number; entries: number }
export async function zipEntries(bytes: Buffer, config: ArchiveConfig, budget: ZipBudget = { expanded: 0, entries: 0 }): Promise<Array<{ name: string; bytes: Buffer }>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value!)));
  return new Promise((resolve, reject) => {
    const entries: Array<{ name: string; bytes: Buffer }> = []; const seen = new Set<string>(); let stopped = false;
    const fail = (error: unknown): void => { if (!stopped) { stopped = true; zip.close(); reject(error); } };
    zip.on('error', fail); zip.on('end', () => { if (!stopped) resolve(entries); });
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        if (++budget.entries > config.maxZipEntries || !safeMember(entry.fileName, entry.externalFileAttributes) || seen.has(entry.fileName)) throw new ArchiveError('UNSAFE_ZIP_ENTRY');
        seen.add(entry.fileName);
        if (entry.isEncrypted()) throw new ArchiveError('ENCRYPTED_ZIP');
        budget.expanded += entry.uncompressedSize;
        if (budget.expanded > config.maxExpandedBytes || entry.uncompressedSize > config.maxFileBytes || (entry.uncompressedSize > 1048576 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 200)) throw new ArchiveError('ZIP_EXPANSION_LIMIT');
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        const stream = await new Promise<NodeJS.ReadableStream>((done, failed) => zip.openReadStream(entry, (err, s) => err ? failed(err) : done(s!)));
        const chunks: Buffer[] = []; let size = 0;
        for await (const value of stream) {
          const chunk = Buffer.from(value); size += chunk.length;
          if (size > entry.uncompressedSize || size > config.maxFileBytes) throw new ArchiveError('ZIP_SIZE_MISMATCH');
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (size !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw new ArchiveError('ZIP_CRC_MISMATCH');
        entries.push({ name: entry.fileName, bytes: data }); zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
