import type { ArchiveConfig, ParsedFile } from './model.js';
import { ArchiveError } from './model.js';
import { sha256 } from '../store/files.js';
import { zipEntries, type ZipBudget } from './zip.js';
import { officeUnits } from './office.js';

export function fileKind(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) || bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 5, 6]))) return 'zip';
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return 'ole';
  if (bytes.subarray(0, 7).toString('hex') === '526172211a0700') return 'rar';
  return 'unknown';
}

/** 只解析内容；返回页、段落或 ZIP 条目定位，扫描件、加密和损坏各自保留状态。 */
export async function parseFile(bytes: Buffer, config: ArchiveConfig, depth = 0, budget: ZipBudget = { expanded: 0, entries: 0 }): Promise<ParsedFile> {
  const result: ParsedFile = { parserVersion: 'p2-v2', kind: fileKind(bytes), status: 'parsed', reason: '', units: [], members: [] };
  try {
    if (bytes.length === 0) throw new ArchiveError('EMPTY_FILE');
    if (result.kind === 'pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, useWorkerFetch: false, verbosity: 0 });
      try {
        const pdf = await task.promise;
        for (let number = 1; number <= Math.min(pdf.numPages, 200); number++) {
          const page = await pdf.getPage(number); const content = await page.getTextContent();
          result.units.push({ locator: `page:${number}`, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim() });
          page.cleanup();
        }
        if (pdf.numPages > 200) { result.status = 'partial'; result.reason = 'PDF_PAGE_LIMIT'; }
        else if (result.units.some(u => u.text.length < 10)) { result.status = 'needs-ocr'; result.reason = 'PAGES_WITHOUT_RELIABLE_TEXT'; }
      } finally { await task.destroy(); }
    } else if (result.kind === 'ole') {
      const markers = bytes.toString('utf16le');
      if (/EncryptedPackage|EncryptionInfo/.test(markers)) throw new ArchiveError('ENCRYPTED_OFFICE');
      const { default: WordExtractor } = await import('word-extractor');
      const document = await new WordExtractor().extract(bytes);
      result.kind = 'doc';
      document.getBody().split(/\r?\n/).forEach((text, i) => { if (text.trim()) result.units.push({ locator: `body:paragraph:${i + 1}`, text }); });
      const extra = [document.getHeaders(), document.getFootnotes(), document.getEndnotes()];
      extra.forEach((text, i) => { if (text.trim()) result.units.push({ locator: ['headers', 'footnotes', 'endnotes'][i]!, text }); });
    } else if (result.kind === 'zip') {
      const entries = await zipEntries(bytes, config, budget);
      if (entries.some(e => e.name === 'word/document.xml')) result.kind = 'docx';
      else if (entries.some(e => e.name === 'xl/workbook.xml')) result.kind = 'xlsx';
      if (result.kind === 'docx' || result.kind === 'xlsx') result.units = officeUnits(entries, result.kind);
      else {
        if (depth >= config.maxArchiveDepth) { result.status = 'partial'; result.reason = 'ARCHIVE_DEPTH_LIMIT'; return result; }
        for (const entry of entries) {
          const child = await parseFile(entry.bytes, config, depth + 1, budget);
          result.members.push({ name: entry.name, sha256: sha256(entry.bytes), size: entry.bytes.length, kind: child.kind, status: child.status, reason: child.reason });
          result.units.push(...child.units.map(u => ({ locator: `zip:${entry.name}/${u.locator}`, text: u.text })));
          if (child.status !== 'parsed') { result.status = 'partial'; result.reason = 'ONE_OR_MORE_MEMBERS_NOT_PARSED'; }
        }
      }
    } else { result.status = 'unsupported'; result.reason = 'UNSUPPORTED_FORMAT'; }
    if (result.status === 'parsed' && !result.units.some(u => u.text.trim())) { result.status = 'partial'; result.reason = 'NO_TEXT_EXTRACTED'; }
    if (result.units.reduce((n, u) => n + u.text.length, 0) > 5_000_000) { result.units = []; result.status = 'partial'; result.reason = 'TEXT_SIZE_LIMIT'; }
  } catch (error) {
    const code = error instanceof ArchiveError ? error.code : error instanceof Error && error.name === 'PasswordException' ? 'ENCRYPTED_PDF' : 'PARSER_REJECTED_FILE';
    result.status = code.includes('ENCRYPTED') ? 'encrypted' : 'invalid'; result.reason = code;
  }
  return result;
}
