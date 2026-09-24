import { checkPublication } from '../run/window.js';
import type { Notice, RuleConfig, RuleDecision, ProjectGroup } from './model.js';
import { sha256 } from '../store/files.js';
import { materialRevision, compareRevision } from './revision.js';

/** 分类只针对公告标题/类型，避免正文引用历史结果造成阶段误判。 */
export function stage(title: string, type: string | null): string {
  const value = `${title} ${type ?? ''}`;
  if (/终止|废标|采购失败|流标/.test(value)) return 'terminated';
  if (/更正|变更|延期|澄清|补充公告/.test(value)) return 'changed';
  if (/合同/.test(value)) return 'contract';
  if (/结果|成交|中标|中选|评标|开标记录/.test(value)) return 'result';
  if (/意向|采购计划/.test(value)) return 'intention';
  if (/招标|磋商|谈判|询价|比价|采购公告/.test(value)) return 'procurement';
  return 'unknown';
}
/** 缺词不是排除理由；金额没有阈值不做隐含筛选。跟踪更新跨越原查询时间窗。 */
export function decide(notice: Notice, rules: RuleConfig, tracked: boolean): RuleDecision {
  const reasons: string[] = [];
  const kind = stage(notice.listing.title, notice.listing.noticeType);
  const keywordPresent = `${notice.listing.title}\n${notice.text}`.includes(rules.keyword);
  const update = tracked && ['changed', 'terminated', 'contract', 'result'].includes(kind);
  const date = checkPublication(notice.listing.publishedAt, notice.window);
  let disposition: RuleDecision['disposition'] = 'retain';
  const review = (reason: string) => { reasons.push(reason); if (disposition !== 'exclude') disposition = 'review'; };
  const exclude = (reason: string) => { reasons.push(reason); disposition = 'exclude'; };
  if (date === 'outside' && !update) exclude('发布时间在固定窗口外');
  if (date === 'review') review('发布时间缺失或精度不足');
  // 已验证的省/市检索范围来自 P1 查询；地区字段不猜测同名城市或履约地。
  if (!notice.listing.region || !/广东|深圳/.test(notice.listing.region)) review('采购地区需核验');
  if (/^(?:北京市?|天津市?|上海市?|重庆市?|河北省?|山西省?|辽宁省?|吉林省?|黑龙江省?|江苏省?|浙江省?|安徽省?|福建省?|江西省?|山东省?|河南省?|湖北省?|湖南省?|海南省?|四川省?|贵州省?|云南省?|陕西省?|甘肃省?|青海省?|台湾省?|广西|内蒙古|西藏|宁夏|新疆)(?:$|自治区)/.test(notice.listing.region ?? '') && !update) exclude('明确的采购地区在广东省外');
  if (notice.completeness !== 'complete') review('正文不完整或尚未采集');
  if (!notice.queryComplete) review('来源查询未覆盖全部结果');
  if (!keywordPresent) review('未出现指定短语，保留供语义分析');
  if (rules.excludeKeywords.some(k => `${notice.listing.title}\n${notice.text}`.includes(k)) && !update) exclude('命中已配置排除词');
  if (update) { disposition = 'review'; reasons.push('已跟踪项目的后续公告必须保留'); }
  if (kind !== 'procurement') review('非明确采购阶段，不视作可直接投标商机');
  if (!reasons.length) reasons.push('确定性检查通过，仍需语义与资格分析');
  return { disposition, reasons, stage: kind, keywordPresent, tracked };
}
function identity(n: Notice): string | null {
  const p = n.fields.projectId; const b = n.fields.buyer;
  if (p.status !== 'found' || b.status !== 'found' || !p.value || !b.value) return null;
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return `${n.purpose}:${normalize(b.value)}:${normalize(p.value)}`;
}
export function projectId(n: Notice): string { return sha256(identity(n) ?? `${n.purpose}:${n.key}`); }
function lot(n: Notice): string {
  const matches = [...n.listing.title.matchAll(/(?:合同包|采购包|包组|标包)\s*[（(]?\s*([0-9一二三四五六七八九十]+)|第([0-9一二三四五六七八九十]+)(?:标段|包)/g)];
  return matches.length === 1 ? matches[0]![0].replace(/\s/g, '') : 'unspecified';
}
/** 仅精确的采购人+项目编号建立关联；公告和标包独立保留。无可靠编号不按标题合并。 */
export function associate(notices: Notice[]): ProjectGroup[] {
  const groups = new Map<string, Notice[]>();
  for (const n of notices) { const id = projectId(n); groups.set(id, [...(groups.get(id) ?? []), n]); }
  return [...groups].map(([id, values]) => {
    const lots = new Map<string, string[]>();
    for (const n of values) { const scope = lot(n); lots.set(scope, [...(lots.get(scope) ?? []), n.version]); }
    const current = values.filter(n => !values.some(other => other.key === n.key && other.version !== n.version
      && compareRevision(materialRevision(n), materialRevision(other)) === 1));
    // 同一公告按正文时间和附件观察选现有版本；不同公告按发布时间排序，无法排序时不猜先后。
    const time = (n: Notice) => {
      const raw = n.listing.publishedAt?.replace(' ', 'T');
      return raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw) ? Date.parse(`${raw}+08:00`) : NaN;
    };
    const times = current.map(time); const ordered = times.every(Number.isFinite);
    const newest = ordered ? current.filter((_, i) => times[i] === Math.max(...times)) : current;
    const stages = new Set(newest.map(n => stage(n.listing.title, n.listing.noticeType)));
    const changed = values.some(n => stage(n.listing.title, n.listing.noticeType) === 'changed');
    const multipleLots = lots.size > 1;
    const status = !ordered || stages.size > 1 || multipleLots ? 'needs-review' : stages.values().next().value ?? 'unknown';
    return { id, basis: identity(values[0]!) ? 'exact-buyer-and-project-number' : 'source-notice-only',
      noticeVersions: values.map(n => n.version), sources: [...new Set(values.map(n => n.key))],
      lots: [...lots].map(([scope, noticeVersions]) => ({ scope, noticeVersions })), status,
      latest: newest.map(n => n.version), currentNoticeVersions: current.map(n => n.version), warnings: [
        ...(!ordered ? ['发布时间精度不足，无法确定最新有效公告'] : []),
        ...(multipleLots ? ['标包独立；单包终止不能视为整个项目终止'] : []),
        ...(changed ? ['有更正：原金额/日期保留原文，变更作用范围及条件需复核'] : []),
        ...(identity(values[0]!) ? [] : ['缺可靠项目编号或采购人，跨公告关联待复核']),
      ] };
  });
}
