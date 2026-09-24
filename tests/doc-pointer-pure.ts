// Extraction and resolution for `<path>.md#<slug>` doc pointers — the
// codebase's wiki links. Grammar and scope: /tests/README.md#doc-pointer-resolution.
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import GithubSlugger from 'github-slugger';
import { Lexer, type Token, walkTokens } from 'marked';

export interface DocPointer {
  citedPath: string;
  slug: string;
  line: number;
}

const DOC_PATH = String.raw`(?<![\w@.~/-])(\/?(?:\.{1,2}\/)*(?:[\w@.-]+\/)*[\w@.-]+\.md)`;
const POINTER = new RegExp(String.raw`${DOC_PATH}#([\p{L}\p{N}_-]+)`, 'gu');
const RETIRED_POINTER = new RegExp(String.raw`${DOC_PATH}[\x60*]*\s+§`, 'gu');

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

export function extractPointers(text: string): DocPointer[] {
  return [...text.matchAll(POINTER)].map((m) => ({ citedPath: m[1], slug: m[2], line: lineOf(text, m.index) }));
}

export function extractRetiredPointers(text: string): Omit<DocPointer, 'slug'>[] {
  return [...text.matchAll(RETIRED_POINTER)].map((m) => ({ citedPath: m[1], line: lineOf(text, m.index) }));
}

const plainText = (tokens: Token[]): string =>
  tokens
    .map((token) => (token.type === 'html' ? '' : 'tokens' in token && token.tokens ? plainText(token.tokens) : token.text))
    .join('');

const HTML_ANCHOR = /<a\s+(?:id|name)="([^"]+)"/g;

export function docAnchors(markdown: string): Set<string> {
  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  walkTokens(new Lexer({ gfm: true }).lex(markdown), (token) => {
    if (token.type === 'heading') anchors.add(slugger.slug(plainText(token.tokens)));
    if (token.type === 'html') {
      for (const m of token.raw.matchAll(HTML_ANCHOR)) anchors.add(m[1]);
    }
  });
  return anchors;
}

export function resolveDocPath(citedPath: string, fromDir: string, root: string): string | null {
  const path = citedPath.startsWith('/') ? join(root, citedPath) : join(fromDir, citedPath);
  return !relative(root, path).startsWith('..') && existsSync(path) ? path : null;
}
