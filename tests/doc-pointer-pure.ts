// Extraction and resolution for `<path>.md#<slug>` doc pointers — the
// codebase's wiki links. Grammar and scope: /tests/README.md#doc-pointer-resolution.
import { existsSync, lstatSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import GithubSlugger from 'github-slugger';
import { Lexer, type Token, walkTokens } from 'marked';
import { gitFiles, lfsTracked } from './walk-files';

export interface DocPointer {
  citedPath: string;
  slug: string;
  line: number;
}

const DOC_PATH = String.raw`(?<![\w@.~/-])(\/?(?:\.{1,2}\/)*(?:[\w@.-]+\/)*[\w@.-]+\.md)`;
const SLUG = String.raw`([\p{L}\p{N}_-]+)`;
const POINTER = new RegExp(`${DOC_PATH}#${SLUG}`, 'gu');
const SAME_FILE_LINK = new RegExp(String.raw`\]\(#${SLUG}\)`, 'gu');
const SECTION_SIGN = /\u00a7/g;
const NUMBERED_LINK_TEXT = /\[\u00a7 \d[^\]\n]*\]\(/y;

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

export function extractPointers(text: string): DocPointer[] {
  return [...text.matchAll(POINTER)].map((m) => ({ citedPath: m[1], slug: m[2], line: lineOf(text, m.index) }));
}

export function extractSameFileLinks(markdown: string): Omit<DocPointer, 'citedPath'>[] {
  return [...markdown.matchAll(SAME_FILE_LINK)].map((m) => ({ slug: m[1], line: lineOf(markdown, m.index) }));
}

const opensNumberedLinkText = (text: string, index: number): boolean => {
  NUMBERED_LINK_TEXT.lastIndex = index - 1;
  return NUMBERED_LINK_TEXT.test(text);
};

export function strayedSectionSigns(text: string, markdown: boolean): number[] {
  return [...text.matchAll(SECTION_SIGN)]
    .filter((m) => !(markdown && opensNumberedLinkText(text, m.index)))
    .map((m) => lineOf(text, m.index));
}

const plainText = (tokens: Token[]): string =>
  tokens
    .map((token) => (token.type === 'html' ? '' : 'tokens' in token && token.tokens ? plainText(token.tokens) : token.text))
    .join('');

const HTML_ANCHOR = /<a\s+(?:id|name)="([^"]+)"/g;

function collectAnchors(markdown: string, headings: boolean): Set<string> {
  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  walkTokens(new Lexer({ gfm: true }).lex(markdown), (token) => {
    if (headings && token.type === 'heading') anchors.add(slugger.slug(plainText(token.tokens)));
    if (token.type === 'html') {
      for (const m of token.raw.matchAll(HTML_ANCHOR)) anchors.add(m[1]);
    }
  });
  return anchors;
}

export const docAnchors = (markdown: string): Set<string> => collectAnchors(markdown, true);
export const explicitAnchors = (markdown: string): Set<string> => collectAnchors(markdown, false);

export function resolveDocPath(citedPath: string, fromDir: string, root: string): string | null {
  const path = citedPath.startsWith('/') ? join(root, citedPath) : join(fromDir, citedPath);
  return !relative(root, path).startsWith('..') && existsSync(path) ? path : null;
}

export const SCANNED_KINDS = ['.ts', '.md', '.py', '.sh', '.css', '.yml', '.html', '.json', '.tsv', '.gitignore'];
const UNSCANNED = [
  // Prefix-frozen by tests/sid-ledger-guard.test.ts: its rows cannot be rewritten.
  'data/sid/retirements.tsv',
  // Quotes tree lines verbatim, pointers included, as evidence of where a paper is cited.
  'data/papers/inventory.json',
];
export const kindOf = (name: string): string => extname(name) || basename(name);

export function pointerCorpus(root: string): string[] {
  const names = gitFiles(root, [], { untracked: true }).filter(
    (name) => SCANNED_KINDS.includes(kindOf(name)) && !UNSCANNED.includes(name),
  );
  const lfs = lfsTracked(root, names);
  return names
    .filter((name) => !lfs.has(name))
    .map((name) => join(root, name))
    .filter((path) => existsSync(path) && !lstatSync(path).isSymbolicLink());
}
