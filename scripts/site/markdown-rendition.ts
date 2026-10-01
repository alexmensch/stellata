/** The markdown rendition of an authored site page, derived from the page's
 *  own HTML so that the two can never come to state different things.
 *  README.md#the-markdown-rendition. */

import type { Element, ElementContent, Root } from 'hast';
import { selectAll, select } from 'hast-util-select';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

import { substituteFigures } from './figures-pure.ts';
import { pageMeta } from './page-meta-pure.ts';
import { collapseWhitespace, parseHtml, textOf } from './parse-html.ts';

const DROPPED = '.holder, .skip-link';

/** Closed: a tag outside it throws — README.md#the-markdown-rendition. */
const VOCABULARY = new Set([
  'a',
  'article',
  'b',
  'body',
  'br',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'header',
  'i',
  'img',
  'li',
  'main',
  'nav',
  'p',
  'section',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

function prune(body: Element, selector: string): void {
  const doomed = new Set<Element>(selectAll(selector, body));
  visit(body, 'element', (node, index, parent) => {
    if (!doomed.has(node) || parent === undefined || index === undefined) return;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

function stripComments(body: Element): void {
  visit(body, 'comment', (_node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

/**
 * Runs BEFORE pruneEmptyLinks: a sight's media anchor wrapping only a
 * `<video>` reads as empty until the video has become an `<img>`, and would
 * be dropped with the link the sight is for.
 */
function stillVideos(body: Element): void {
  for (const video of selectAll('video', body)) {
    const poster = video.properties?.poster;
    const label = video.properties?.['ariaLabel'];
    if (typeof poster !== 'string' || poster === '') {
      throw new Error('markdown rendition: <video> carries no poster to stand in for it');
    }
    if (typeof label !== 'string' || label === '') {
      throw new Error('markdown rendition: <video> carries no aria-label to name it');
    }
    video.tagName = 'img';
    video.properties = { src: poster, alt: label };
    video.children = [];
  }
}

function collapseAlts(body: Element): void {
  for (const img of selectAll('img', body)) {
    const alt = img.properties?.alt;
    if (typeof alt === 'string') img.properties.alt = collapseWhitespace(alt);
  }
}

function pruneEmptyLinks(body: Element): void {
  visit(body, 'element', (node, index, parent) => {
    if (node.tagName !== 'a' || parent === undefined || index === undefined) return;
    if (textOf(node) !== '' || select('img', node) != null) return;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

function absolutise(body: Element, origin: string): void {
  visit(body, 'element', (node: Element) => {
    for (const key of ['href', 'src']) {
      const value = node.properties?.[key];
      if (typeof value === 'string') node.properties[key] = new URL(value, origin).toString();
    }
  });
}

function shiftHeadings(body: Element): void {
  visit(body, 'element', (node: Element) => {
    const heading = /^h([1-5])$/.exec(node.tagName);
    if (heading !== null) node.tagName = `h${Number(heading[1]) + 1}`;
  });
}

function bulletDefinitions(body: Element): void {
  for (const list of selectAll('dl', body)) {
    const terms = selectAll('dt', list);
    const values = selectAll('dd', list);
    list.tagName = 'ul';
    list.properties = {};
    list.children = terms.map(
      (term, i): ElementContent => ({
        type: 'element',
        tagName: 'li',
        properties: {},
        children: [
          { type: 'element', tagName: 'strong', properties: {}, children: term.children },
          { type: 'text', value: ' \u2014 ' },
          ...(values[i]?.children ?? []),
        ],
      }),
    );
  }
}

function assertVocabulary(body: Element): void {
  const unknown = new Set<string>();
  visit(body, 'element', (node: Element) => {
    if (!VOCABULARY.has(node.tagName)) unknown.add(node.tagName);
  });
  if (unknown.size > 0) {
    throw new Error(
      `markdown rendition: no rule for <${[...unknown].sort().join('>, <')}> — ` +
        'decide what it means in markdown and add it to VOCABULARY',
    );
  }
}

export function markdownRendition(
  source: string,
  figures: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const html = substituteFigures(source, figures, 'markdown rendition');
  const tree = parseHtml(html);

  const canonical = select('link[rel="canonical"]', tree)?.properties?.href;
  if (typeof canonical !== 'string') {
    throw new Error('markdown rendition: the page states no canonical URL');
  }
  const { title, description } = pageMeta(html, 'markdown rendition');

  const body = select('body', tree);
  if (body == null) throw new Error('markdown rendition: the page has no <body>');

  stripComments(body);
  prune(body, DROPPED);
  stillVideos(body);
  collapseAlts(body);
  pruneEmptyLinks(body);
  assertVocabulary(body);
  bulletDefinitions(body);
  const baseHref = select('head > base', tree)?.properties?.href;
  absolutise(body, typeof baseHref === 'string' ? new URL(baseHref, canonical).toString() : canonical);
  shiftHeadings(body);

  const mdast = unified()
    .use(rehypeRemark)
    .runSync({ type: 'root', children: [body] } as Root);
  const converted = unified()
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true })
    .stringify(mdast as never);

  const preamble = [
    `# ${title}`,
    `> ${description}`,
    `[Read this page as HTML](${canonical})`,
  ];

  return `${preamble.join('\n\n')}\n\n${converted.trim()}\n`;
}
