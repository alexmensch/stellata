/** The post-deploy check's verdicts, each a failure message or null. README.md#the-post-deploy-check. */

import { select, selectAll } from 'hast-util-select';

import { MAGIC, readCatalogHeader } from '../catalog/record/catalog-pure.ts';
import { parseHtml, textOf } from '../util/parse-html.ts';
import type { RoutingCase, ServedDocument } from '../../src/routing-cases-fixture.ts';
import { locationPath, type RawAnswer } from './raw-get.ts';

export type Verdict = string | null;

export function judgeCase(
  routingCase: RoutingCase,
  answer: RawAnswer,
  identifies: Readonly<Record<ServedDocument, (body: string) => boolean>>,
): Verdict {
  const request = routingCase.pathname + routingCase.search;
  const expected = routingCase.answer;
  if ('redirect' in expected) {
    const to = locationPath(answer.location);
    return answer.status === expected.status && to === expected.redirect
      ? null
      : `${request}: expected ${expected.status} → ${expected.redirect}, got ${answer.status} → ${to}`;
  }
  const status = expected.document === 'notFound' ? 404 : 200;
  if (answer.status !== status) return `${request}: expected ${status}, got ${answer.status}`;
  return identifies[expected.document](answer.body.toString('utf8'))
    ? null
    : `${request}: the body is not the ${expected.document} document`;
}

/** The app document's module entry, as its build emitted it. */
export function entryScriptOf(html: string): string | null {
  const entry = selectAll('script[src]', parseHtml(html)).find(
    (script) => String(script.properties.type).toLowerCase() === 'module',
  );
  return entry === undefined ? null : String(entry.properties.src);
}

export function judgeEntryScript(answer: RawAnswer): Verdict {
  const type = String(answer.headers['content-type'] ?? '');
  if (answer.status !== 200) return `entry script: expected 200, got ${answer.status}`;
  return /\b(java|ecma)script\b/.test(type) ? null : `entry script: served as ${type || 'no type'}`;
}

export function judgeCatalogue(answer: RawAnswer): Verdict {
  if (answer.status !== 200) return `catalogue chunk 0: expected 200, got ${answer.status}`;
  const { buffer, byteOffset, byteLength } = answer.body;
  try {
    const header = readCatalogHeader(buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer);
    return header.magic === MAGIC ? null : `catalogue chunk 0: magic ${header.magic}`;
  } catch (err) {
    return `catalogue chunk 0: ${(err as Error).message}`;
  }
}

export function footerVersionOf(html: string): string | null {
  const shown = select('.footer-version', parseHtml(html));
  return shown === undefined ? null : textOf(shown).replace(/^v/, '');
}

export function judgeFooterVersion(html: string, version: string): Verdict {
  const shown = footerVersionOf(html);
  return shown === version ? null : `homepage footer: expected v${version}, shows ${shown === null ? 'none' : `v${shown}`}`;
}

export interface RetryPlan {
  attempts: number;
  waitMs: number;
  sleep: (ms: number) => Promise<void>;
}

/** Re-runs the whole check until it passes or the attempts run out; the edge takes a few seconds to see a deploy. */
export async function untilPassing(run: () => Promise<Verdict[]>, plan: RetryPlan): Promise<string[]> {
  let failures: string[] = [];
  for (let attempt = 1; attempt <= plan.attempts; attempt++) {
    failures = (await run()).filter((verdict): verdict is string => verdict !== null);
    if (failures.length === 0) return [];
    if (attempt < plan.attempts) await plan.sleep(plan.waitMs);
  }
  return failures;
}
