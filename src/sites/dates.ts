import type { Detail } from '../model.js';

const labels = [
  ['response-deadline', /(?:提交投标文件截止|投标截止|响应文件提交截止|响应文件递交截止|^截止时间)/],
  ['registration-deadline', /截止报名时间|报名截止/],
  ['opening', /开标时间/],
  ['document-window', /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?获取(?:招标|采购|磋商)文件(?:时间)?(?:[：:]|$)/],
] as const;
const otherField = /提交投标文件截止|投标截止|响应文件(?:提交|递交)截止|截止报名时间|报名截止|开标时间|获取(?:招标|采购|磋商)文件|截止时间|公告期限|发布(?:日期|时间)|(?:地点|方式|售价|联系人)[：:]/;
const datePattern = /20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}日?(?:\s*\d{1,2}(?::\d{2}(?::\d{2})?|时(?:\d{1,2}分?(?:\d{1,2}秒)?)?))?/g;

function fieldText(lines: string[], index: number, label: RegExp): string {
  const match = label.exec(lines[index]!)!;
  const prefix = lines[index]!.slice(match.index, match.index + match[0].length);
  const rest = lines[index]!.slice(match.index + match[0].length);
  // 明确合并的标题共用下一行时间；“截止时间：详见…；开标时间：…”仍是独立字段。
  const sharedHeading = /^(?:时间)?(?:[、，\s]+|和|及)开标时间(?:(?:和|及)?地点)?[：:]?$/.test(rest);
  const boundary = sharedHeading ? -1 : rest.search(otherField);
  const parts = [prefix + (boundary < 0 ? rest : rest.slice(0, boundary))];
  if (boundary >= 0 || /^(?:时间)?\s*[：:]?\s*(?:详见|见|待定|另行|未定|以)/.test(rest)) return parts[0]!;
  for (const next of lines.slice(index + 1, index + 4)) {
    // 允许标题后的“时间：”和日期续行；其他字段、章节不能为当前缺失值补日期。
    if (otherField.test(next) || /^[一二三四五六七八九十\d]+[、.．]/.test(next)) break;
    if (!/^20\d{2}[年/-]/.test(next) && /^(?!时间[：:])[^：:]{1,30}[：:]/.test(next)) break;
    parts.push(next);
  }
  return parts.join(' ');
}

/** 日期只能来自所属字段；冲突值全部保留，缺失字段不借用相邻开标或报名时间。 */
export function extractDates(lines: string[]): Detail['fields']['dates'] {
  const dates: Detail['fields']['dates'] = [];
  for (const [index, line] of lines.entries()) for (const [kind, label] of labels) {
    if (!label.test(line)) continue;
    const evidence = fieldText(lines, index, label);
    const matches = [...evidence.matchAll(datePattern)];
    if (!matches.length) continue;
    const actualKind = kind === 'response-deadline' && !/投标|响应/.test(evidence) ? 'unclassified-deadline' : kind;
    if (kind === 'document-window' && matches[1]) {
      dates.push({ kind, raw: evidence.slice(matches[0]!.index, matches[1].index! + matches[1][0].length), evidence });
    } else for (const match of matches) dates.push({ kind: actualKind, raw: match[0], evidence });
  }
  return [...new Map(dates.map(x => [`${x.kind}:${x.raw}`, x])).values()];
}
