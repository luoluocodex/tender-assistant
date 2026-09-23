import { crc32 } from 'node:zlib';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { ArchiveConfig, Candidate } from '../../src/archive/model.js';
import { sha256 } from '../../src/store/files.js';

/** 明确的合成数据，只在 output/playwright/tests 下保存。 */
export async function fixtureRoot(): Promise<string> { const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true }); return mkdtemp(join(parent, 'p2-synthetic-')); }
export function testConfig(root: string, origin = 'http://127.0.0.1:1'): ArchiveConfig {
  return { runtimeRoot: root, minIntervalMs: 1, maxFiles: 10, maxFileBytes: 1024 * 1024, timeoutMs: 2000, parseTimeoutMs: 15000, maxRunMinutes: 1, maxZipEntries: 20, maxExpandedBytes: 4 * 1024 * 1024, maxArchiveDepth: 2, sources: [{ id: 'synthetic', origin, pathPrefix: '/' }] };
}
export function syntheticCandidate(url = 'http://127.0.0.1:1/file', version = 'v1'): Candidate {
  const payload = { title: '合成测试公告', text: `合成正文 ${version}` };
  return { purpose: 'diagnostic', noticeKey: sha256('synthetic:notice'), noticeVersion: sha256(version), noticeId: 'SYNTHETIC', noticeUrl: 'https://example.invalid/synthetic-notice', title: '合成测试公告', noticePayload: payload, attachmentId: sha256(version + url), name: '合成附件.pdf', url };
}
export function syntheticPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 30 750 Td (Synthetic tender fixture) Tj ET';
  const bodies = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets: number[] = [0];
  bodies.forEach((body, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const start = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}
/** 小型无压缩 ZIP fixture，用于损坏、路径和文档结构边界测试。 */
export function syntheticZip(files: Record<string, string | Buffer>, encrypted = false): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name); const data = Buffer.isBuffer(value) ? value : Buffer.from(value); const crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt16LE(0x800 | (encrypted ? 1 : 0),6); h.writeUInt32LE(crc,14); h.writeUInt32LE(data.length,18); h.writeUInt32LE(data.length,22); h.writeUInt16LE(filename.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(0x800 | (encrypted ? 1 : 0),8); c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(filename.length,28); c.writeUInt32LE(offset,42);
    const stored = encrypted ? Buffer.concat([Buffer.alloc(12),data]) : data;
    h.writeUInt32LE(stored.length,18); c.writeUInt32LE(stored.length,20);
    local.push(h,filename,stored); central.push(c,filename); offset += h.length + filename.length + stored.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length,8); end.writeUInt16LE(Object.keys(files).length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
