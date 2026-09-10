/** The markdown rendition of an authored site page, derived from the page's
 *  own HTML so that the two can never come to state different things.
 *  README.md § The markdown rendition. */

import type { Element, ElementContent, Root } from 'hast';
import { selectAll, select } from 'hast-util-select';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/**
 * Authoring scaffolding, dropped from the rendition. `.holder` is the dashed
 * box naming a capture still to be taken — instructions to the author, and
 * the last thing an agent quoting the page should read back. The skip link is
 * a keyboard affordance carrying no content of its own.
 */
const DROPPED = '.holder, .skip-link';

/**
 * Every element the authored pages may use. A tag outside this set throws
 * rather than being converted on a guess: the conversion is `rehype-remark`'s
 * to make, and a page that reaches for `<details>` or `<aside>` needs someone
 * to decide what it means in markdown first.
 */
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

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5'] as const;

function prune(body: Element, selector: string): void {
  const doomed = new Set<Element>(selectAll(selector, body));
  visit(body, 'element', (node, index, parent) => {
    if (!doomed.has(node) || parent === undefined || index === undefined) return;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

/**
 * Anchors left with nothing in them once the scaffolding went. A sight's
 * picture *is* its link, so until the captures land the media anchor wraps a
 * `.holder` and nothing else — and `[](url)` is noise in a rendition whose
 * point is that an agent reads it verbatim. The "Fly there" anchor beside it
 * carries the same URL, and once a capture lands the `<img>` keeps the anchor.
 */
function pruneEmptyLinks(body: Element): void {
  visit(body, 'element', (node, index, parent) => {
    if (node.tagName !== 'a' || parent === undefined || index === undefined) return;
    if (textOf(node) !== '' || select('img', node) != null) return;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

/** Root-relative links resolved against the page's own canonical, so a
 *  rendition quoted somewhere else still points back here. */
function absolutise(body: Element, origin: string): void {
  visit(body, 'element', (node: Element) => {
    for (const key of ['href', 'src']) {
      const value = node.properties?.[key];
      if (typeof value === 'string') node.properties[key] = new URL(value, origin).toString();
    }
  });
}

/** The page's `<title>` becomes the document's one top-level heading, so
 *  every heading in the body moves down a level to sit under it. */
function shiftHeadings(body: Element): void {
  visit(body, 'element', (node: Element) => {
    const level = HEADINGS.indexOf(node.tagName as (typeof HEADINGS)[number]);
    if (level >= 0) node.tagName = HEADINGS[level + 1] ?? 'h6';
  });
}

/**
 * A definition list as labelled bullets. The readout strip is five labelled
 * figures, which `dl` says in HTML — but mdast has no definition list, so
 * `rehype-remark` would otherwise flatten the labels and values into one run
 * of text with nothing saying which figure belongs to which label.
 */
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

function textOf(node: Element | null | undefined): string {
  if (node == null) return '';
  let out = '';
  visit(node, 'text', (text: { value: string }) => {
    out += text.value;
  });
  return out.replace(/\s+/g, ' ').trim();
}

function metaContent(tree: Root, name: string): string | null {
  const meta = select(`meta[name="${name}"]`, tree);
  const content = meta?.properties?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * The build-time figures the page asks for. Vite substitutes these into the
 * HTML it emits; the rendition is derived from the authored source, so it
 * resolves them from the same environment rather than shipping the token.
 */
function substitute(markdown: string, env: NodeJS.ProcessEnv): string {
  return markdown.replace(/%(VITE_[A-Z_]+)%/g, (raw, name: string) => {
    const value = env[name];
    if (value === undefined || value === '') {
      throw new Error(`markdown rendition: ${raw} has no value — publishBuildEnv did not run`);
    }
    return value;
  });
}

/**
 * The page as markdown: its `<title>` as the one top-level heading and its
 * meta description as the summary blockquote, which is the shape `llms.txt`
 * uses and agent clients already read.
 */
export function markdownRendition(source: string, env: NodeJS.ProcessEnv = process.env): string {
  const html = substitute(source, env);
  const tree = unified().use(rehypeParse).parse(html) as Root;

  const canonical = select('link[rel="canonical"]', tree)?.properties?.href;
  if (typeof canonical !== 'string') {
    throw new Error('markdown rendition: the page states no canonical URL');
  }
  const title = textOf(select('title', tree));
  if (title === '') throw new Error('markdown rendition: the page has no <title>');

  const body = select('body', tree);
  if (body == null) throw new Error('markdown rendition: the page has no <body>');

  prune(body, DROPPED);
  pruneEmptyLinks(body);
  assertVocabulary(body);
  bulletDefinitions(body);
  absolutise(body, canonical);
  shiftHeadings(body);

  const mdast = unified()
    .use(rehypeRemark)
    .runSync({ type: 'root', children: [body] } as Root);
  const converted = unified()
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true })
    .stringify(mdast as never);

  const description = metaContent(tree, 'description');
  const preamble = [
    `# ${title}`,
    ...(description === null ? [] : [`> ${description.replace(/\s+/g, ' ').trim()}`]),
    `[Read this page as HTML](${canonical})`,
  ];

  return `${preamble.join('\n\n')}\n\n${converted.trim()}\n`;
}
