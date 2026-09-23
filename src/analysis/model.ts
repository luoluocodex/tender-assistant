import type { Detail, Listing, QueryWindow } from '../model.js';
import type { Company } from './contract.js';

export interface Evidence { id: string; kind: 'title' | 'body' | 'attachment' | 'company'; locator: string; text: string; sha256: string; sourceHash: string }
export interface AttachmentText { name: string; sha256: string; parseSha: string; status: string; units: Array<{ locator: string; text: string }> }
export interface Notice {
  key: string; version: string; purpose: 'formal' | 'diagnostic'; listing: Listing; text: string;
  completeness: string; fields: Detail['fields']; fetchedAt: string | null;
  attachmentCount: number | null; attachments: AttachmentText[];
  window: QueryWindow; queryComplete: boolean; queryIds: string[];
}
export interface RuleConfig { version: string; keyword: string; region: string; excludeKeywords: string[] }
export interface RuleDecision { disposition: 'retain' | 'review' | 'exclude'; reasons: string[]; stage: string; keywordPresent: boolean; tracked: boolean }
export interface Packet {
  schemaVersion: 1; packetId: string; inputHash: string; notice: Notice; rules: RuleConfig; decision: RuleDecision;
  promptVersion: string; prompts: Record<string, string>; company: Company | null; companyVersion: string;
  evidence: Evidence[]; coverage: { body: string; attachments: string; scope: 'selected-notice-only' };
}
export interface ProjectGroup { id: string; basis: string; noticeVersions: string[]; sources: string[];
  lots: Array<{ scope: string; noticeVersions: string[] }>; status: string; latest: string[]; currentNoticeVersions: string[]; warnings: string[] }
export interface AnalysisSnapshot { schemaVersion: 1; phase: 'P3'; id: string; createdAt: string;
  purpose: 'formal' | 'diagnostic'; reportHash: string; sourceReport: string; rules: RuleConfig;
  packets: Packet[]; projects: ProjectGroup[]; p3AcceptanceComplete: false }
