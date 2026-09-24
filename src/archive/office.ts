import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ArchiveError } from './model.js';
import type { ParsedFile } from './model.js';
import { object } from './config.js';

function xml(bytes: Buffer, preserveOrder = false): unknown {
  const text = bytes.toString('utf8');
  if (text.length > 20_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new ArchiveError('INVALID_OR_UNSAFE_XML');
  return new XMLParser({ preserveOrder, trimValues: !preserveOrder, ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, processEntities: false }).parse(text);
}
function paragraphs(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(paragraphs);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, children]) => key === 'w:p' ? [children] : paragraphs(children));
}
function values(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap(x => values(x, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => k === key ? Array.isArray(v) ? v : [v] : values(v, key));
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object') return Object.entries(value).filter(([k]) => !k.startsWith('@')).map(([,v]) => text(v)).join('');
  return '';
}

/** 保留段落或工作表/单元格定位，不执行 Office 宏与公式。 */
export function officeUnits(entries: Array<{ name: string; bytes: Buffer }>, kind: 'docx' | 'xlsx'): ParsedFile['units'] {
  const units: ParsedFile['units'] = [];
  if (kind === 'docx') {
    for (const entry of entries.filter(e => /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(e.name))) {
      // 有序节点数组不能把 w:p 的子节点误当成多个段落；表格和超链接也按原顺序遍历。
      paragraphs(xml(entry.bytes, true)).forEach((p, i) => { const content = values(p, 'w:t').map(text).join(''); if (content.trim()) units.push({ locator: `${entry.name}:paragraph:${i + 1}`, text: content }); });
    }
  } else {
    const shared = entries.find(e => e.name === 'xl/sharedStrings.xml');
    const strings = shared ? values(xml(shared.bytes), 'si').map(s => values(s, 't').map(text).join('')) : [];
    for (const entry of entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))) {
      for (const c of values(xml(entry.bytes), 'c')) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const cell = object(c); const raw = text(cell.v);
        const content = cell['@t'] === 's' ? strings[Number(raw)] ?? '' : cell['@t'] === 'inlineStr' ? values(cell.is, 't').map(text).join('') : raw;
        const formula = cell.f ? ` [公式缓存；未计算: ${text(cell.f)}]` : '';
        if (content || formula) units.push({ locator: `${entry.name}!${text(cell['@r'])}`, text: content + formula });
      }
    }
  }
  return units;
}
