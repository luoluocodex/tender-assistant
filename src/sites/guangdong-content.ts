import type { Page } from 'playwright';
import type { Detail, Listing } from '../model.js';
import type { RunContext } from '../run/context.js';
import { makeDetail, navigate, pageProblem } from './page.js';

interface DomNode {
  backendNodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  shadowRootType?: string;
}

/** 仅查找公告 richtext 容器里的封闭 Shadow DOM，不读取浏览器存储或认证信息。 */
function closedRoots(node: DomNode, inContent = false): number[] {
  const attributes = node.attributes ?? [];
  const classIndex = attributes.indexOf('class');
  const classes = classIndex >= 0 ? attributes[classIndex + 1]?.split(/\s+/) ?? [] : [];
  const relevant = inContent || classes.includes('richtext');
  return [
    ...(relevant && node.shadowRootType === 'closed' ? [node.backendNodeId] : []),
    ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(child => closedRoots(child, relevant)),
  ];
}

/** 读取页面已经渲染的封闭正文；失败时交由上层保留 partial，不能以空文本宣称成功。 */
export async function readClosedContent(page: Page): Promise<{ text: string; html: string }> {
  const session = await page.context().newCDPSession(page);
  try {
    const document = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const chunks: Array<{ text: string; html: string }> = [];
    for (const id of closedRoots(document.root)) {
      const resolved = await session.send('DOM.resolveNode', { backendNodeId: id });
      if (!resolved.object.objectId) continue;
      const objectId = resolved.object.objectId;
      try {
        const response = await session.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function() {
            const nodes = Array.from(this.children).filter(e => !['STYLE', 'SCRIPT'].includes(e.tagName));
            return { text: nodes.map(e => e.innerText || e.textContent || '').join('\\n'), html: nodes.map(e => e.outerHTML).join('\\n') };
          }`,
          returnByValue: true,
        });
        const value: unknown = response.result.value;
        if (value && typeof value === 'object' && 'text' in value && 'html' in value && typeof value.text === 'string' && typeof value.html === 'string') chunks.push({ text: value.text, html: value.html });
      } finally { await session.send('Runtime.releaseObject', { objectId }); }
    }
    return { text: chunks.map(x => x.text).join('\n'), html: chunks.map(x => x.html).join('\n') };
  } finally { await session.detach(); }
}

/** 广东详情可能只有结构化表，或同时存在封闭正文，按实际模板判定完整性。 */
export async function readGuangdongDetail(page: Page, listing: Listing, run: RunContext): Promise<Detail> {
  if (new URL(listing.url).hostname !== 'ygp.gdzwfw.gov.cn' || !listing.url.includes('/new/jygg/')) throw new Error('尚未解析出可信的广东详情链接');
  await navigate(page, listing.url);
  await page.getByRole('heading', { name: /^(公告信息|公示信息|合同信息)$/ }).first().waitFor();
  await page.locator('main table td').first().waitFor();
  const main = await page.locator('main').innerText();
  const problem = pageProblem(await page.title(), main);
  if (problem) throw new Error(problem);
  const richtext = page.locator('main .richtext');
  const hasBodySection = await page.getByRole('heading', { name: '公告内容', exact: true }).count() > 0;
  if (hasBodySection) await page.waitForFunction(() => [...document.querySelectorAll('main .richtext')].some(e => e.getBoundingClientRect().height > 60), undefined, { timeout: 5000 }).catch(() => {});
  let body = await richtext.allInnerTexts().then(texts => texts.join('\n'));
  let shadowEvidence: string | null = null;
  if (hasBodySection && body.trim().length < 80) {
    const shadow = await readClosedContent(page);
    body = shadow.text;
    shadowEvidence = await run.json(`gd-shadow-${listing.id}`, { sourceUrl: listing.url, ...shadow });
  }
  const text = body ? `${main}\n\n【公告正文】\n${body}` : main;
  const rowCount = await page.locator('main table tr').count();
  const complete = hasBodySection ? body.trim().length > 150 && /项目|采购|合同|更正/.test(body) : rowCount >= 3 && /服务内容|合同|采购项目|项目编码|标的/.test(main);
  const detail = makeDetail(listing, listing.title, text, complete, complete ? hasBodySection ? '已提取公告信息及可见正文（含封闭 Shadow DOM）；附件未下载' : '此模板仅有公告信息表，已提取表格；附件未下载' : '公告正文缺失或模板不支持，需复核');
  detail.sourceFiles = await run.evidence(page, `gd-detail-${listing.id}`);
  if (shadowEvidence) detail.sourceFiles.push(shadowEvidence);
  return detail;
}
