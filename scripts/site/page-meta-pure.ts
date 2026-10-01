/** A page's `<title>` and meta description, the one source every restatement of them is filled from. README.md#the-page-meta. */

import { select } from 'hast-util-select';

import { collapseWhitespace, parseHtml, textOf } from './parse-html.ts';

export interface PageMeta {
  readonly title: string;
  readonly description: string;
}

export const PAGE_TOKEN = /%PAGE_(\w+)%/g;

export function pageMeta(html: string, where: string): PageMeta {
  const tree = parseHtml(html);
  const title = textOf(select('title', tree));
  if (title === '') throw new Error(`${where}: the page has no <title>`);
  const content = select('meta[name="description"]', tree)?.properties?.content;
  const description = typeof content === 'string' ? collapseWhitespace(content) : '';
  if (description === '') throw new Error(`${where}: the page has no meta description`);
  for (const value of [title, description]) {
    if (new RegExp(PAGE_TOKEN.source).test(value)) throw new Error(`${where}: "${value}" is itself a %PAGE_…% token`);
  }
  return { title, description };
}

export function substitutePageMeta(
  text: string,
  meta: PageMeta,
  where: string,
  encode: (value: string) => string = (value) => value,
): string {
  return text.replace(PAGE_TOKEN, (raw, name: string) => {
    if (name === 'TITLE') return encode(meta.title);
    if (name === 'DESCRIPTION') return encode(meta.description);
    throw new Error(`${where}: ${raw} names neither %PAGE_TITLE% nor %PAGE_DESCRIPTION%`);
  });
}

export function llmsTxt(template: string, homeHtml: string): string {
  return substitutePageMeta(template, pageMeta(homeHtml, 'llms.txt'), 'llms.txt');
}
