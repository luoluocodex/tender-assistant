import type { Detail, FieldEvidence } from '../model.js';

function pick(lines: string[], pattern: RegExp): FieldEvidence {
  const matches = lines.flatMap(line => {
    const match = line.match(pattern);
    return match?.[1]?.trim() ? [{ value: match[1].trim().split('\t')[0]!, evidence: line }] : [];
  });
  const unique = [...new Map(matches.map(x => [x.value, x])).values()];
  if (!unique.length) return { value: null, evidence: null, status: 'missing' };
  if (unique.length > 1) return { value: null, evidence: unique.map(x => x.evidence).join('\n'), status: 'ambiguous' };
  return { ...unique[0]!, status: 'found' };
}

/** 保留原文金额和日期，不把预算、限价、成交价或各类截止时间混为一谈。 */
export function extractFields(text: string): Detail['fields'] {
  const lines = text.split(/\r?\n/).map(x => x.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  const amounts: Detail['fields']['amounts'] = [];
  const dates: Detail['fields']['dates'] = [];
  for (const [index, line] of lines.entries()) {
    for (const [kind, label] of [['budget', /预算(?:金额|总额)?/], ['ceiling', /最高限价/], ['award', /(?:中标\s*[（(]?\s*成交\s*[）)]?|中标|成交)\s*(?:金额|总额|价格)/], ['service-fee', /服务金额/]] as const) {
      if (!label.test(line)) continue;
      const tail = line.slice(line.search(label));
      const evidence = tail + (/[0-9].*(?:元|万元)/.test(tail) ? '' : ` ${lines[index + 1] ?? ''}`);
      const match = evidence.match(/(?:人民币)?[¥￥]?\s*\d[\d,，]*(?:\.\d+)?\s*(?:万|亿)?元/);
      if (match) amounts.push({ kind, raw: match[0].trim(), evidence });
    }
    for (const [kind, label] of [['response-deadline', /(?:提交投标文件截止|投标截止|响应文件提交截止|响应文件递交截止|^截止时间)/], ['registration-deadline', /截止报名时间|报名截止/], ['opening', /开标时间/], ['document-window', /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?获取(?:招标|采购|磋商)文件(?:时间)?(?:[：:]|$)/]] as const) {
      if (!label.test(line)) continue;
      const evidence = [line, ...lines.slice(index + 1, index + 4)].join(' ');
      const matches = [...evidence.matchAll(/20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}日?(?:\s*\d{1,2}(?::\d{2}(?::\d{2})?|时(?:\d{1,2}分?(?:\d{1,2}秒)?)?))?/g)];
      const match = matches[0];
      if (match) {
        const raw = kind === 'document-window' && matches[1] ? evidence.slice(match.index, matches[1].index! + matches[1][0].length) : match[0];
        dates.push({ kind: kind === 'response-deadline' && !/投标|响应/.test(evidence) ? 'unclassified-deadline' : kind, raw, evidence });
      }
    }
  }
  const buyerLines = [...lines];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:\d+[.、．]\s*)?采购人信息$/.test(lines[i]!)) continue;
    const name = lines.slice(i + 1, i + 4).find(line => /^名\s*称[：:]/.test(line));
    if (name) buyerLines.push(`采购人：${name.replace(/^名\s*称[：:]\s*/, '')}`);
  }
  return {
    projectId: pick(lines, /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:采购项目编号|采购项目编码|项目编码|项目编号|招标编号)\s*[：:\t]\s*(.+)$/),
    buyer: pick(buyerLines, /^(?:采购人(?:名称)?|采购单位|招标人(?:名称)?|项目业主名称)\s*[：:\t]\s*(.+)$/),
    amounts: [...new Map(amounts.map(x => [`${x.kind}:${x.raw}`, x])).values()],
    dates: [...new Map(dates.map(x => [`${x.kind}:${x.raw}`, x])).values()],
  };
}
