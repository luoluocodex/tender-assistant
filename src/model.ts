/** 单次查询固定的北京时间窗口；endAt 不随翻页延后。 */
export interface QueryWindow {
  startDate: string;
  endDate: string;
  startAt: string;
  endAt: string;
  timezone: 'Asia/Shanghai';
}

/** 来自列表的候选；列表命中不代表业务相关或可投标。 */
export interface Listing {
  site: string;
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  region: string | null;
  noticeType: string | null;
  evidence: string;
}

/** 字段保留原文和位置，缺失或多个值时交由人工复核。 */
export interface FieldEvidence {
  value: string | null;
  evidence: string | null;
  status: 'found' | 'missing' | 'ambiguous';
}

/** 详情完整性仅指已显示公告正文，不包含采购附件。 */
export interface Detail {
  listing: Listing;
  status: 'complete' | 'partial' | 'failed' | 'needs-human';
  reason: string;
  fetchedAt: string;
  title: string | null;
  text: string;
  sha256: string;
  fields: {
    projectId: FieldEvidence;
    buyer: FieldEvidence;
    amounts: Array<{ kind: string; raw: string; evidence: string }>;
    dates: Array<{ kind: string; raw: string; evidence: string }>;
  };
  attachments: Array<{ name: string; url: string; status: 'not-downloaded' }>;
  sourceFiles: string[];
}

/** 每个站点、地区、搜索方式独立记录，异常不冒充零结果。 */
export interface QueryResult {
  id: string;
  site: string;
  keyword: string;
  region: string;
  mode: 'title' | 'fulltext' | 'site-default';
  window: QueryWindow;
  status: 'running' | 'complete' | 'partial' | 'failed' | 'needs-human';
  reason: string;
  totalReported: number | null;
  pages: Array<{ number: number; count: number; signature: string; evidence: string[] }>;
  listings: Listing[];
  duplicates: number;
  excluded: Array<{ listing: Listing; reason: string }>;
  needsReview: Array<{ listing: Listing; reason: string }>;
  queryEvidence: Record<string, unknown>;
}

/** 配置值均在启动浏览器前验证。 */
export interface RunConfig {
  outputDir: string;
  headless: boolean;
  maxPages: number;
  maxDetailsPerSite: number;
  minIntervalMs: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  maxRunMinutes: number;
  keyword: string;
  sites: Array<{ id: string; entryUrl: string }>;
}
