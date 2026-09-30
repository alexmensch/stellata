/** An authored page as a HAST tree, read with a real HTML parser rather than a pattern, and its text as a reader sees it. */

import type { Element, Root } from 'hast';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export function parseHtml(source: string): Root {
  return unified().use(rehypeParse).parse(source) as Root;
}

export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function textOf(node: Element | Root | null | undefined): string {
  if (node == null) return '';
  let out = '';
  visit(node, 'text', (text: { value: string }) => {
    out += text.value;
  });
  return collapseWhitespace(out);
}
