/** An authored page as a HAST tree, read with a real HTML parser rather than a pattern. */

import type { Root } from 'hast';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';

export function parseHtml(source: string): Root {
  return unified().use(rehypeParse).parse(source) as Root;
}
