// Extraction and resolution for `<path>.md#<slug>` doc pointers — the
// codebase's wiki links. Grammar and scope: /tests/README.md#doc-pointer-resolution.
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import GithubSlugger from 'github-slugger';
import { Lexer, type Token } from 'marked';

export interface DocPointer {
  citedPath: string;
  slug: string;
  line: number;
}

const POINTER = /(?<![\w@.~/-])(\/?(?:\.{1,2}\/)*(?:[\w@.-]+\/)*[\w@.-]+\.md)#([\p{L}\p{N}_-]+)/gu;

export function extractPointers(text: string): DocPointer[] {
  return [...text.matchAll(POINTER)].map((m) => ({
    citedPath: m[1],
    slug: m[2],
    line: text.slice(0, m.index).split('\n').length,
  }));
}

type MdToken = Token & {
  text?: string;
  tokens?: MdToken[];
  items?: MdToken[];
  header?: { tokens: MdToken[] }[];
  rows?: { tokens: MdToken[] }[][];
};

const plainText = (token: MdToken): string =>
  token.type === 'html' ? '' : token.tokens ? token.tokens.map(plainText).join('') : (token.text ?? '');

const children = (token: MdToken): MdToken[] => [
  ...(token.tokens ?? []),
  ...(token.items ?? []),
  ...(token.header ?? []).flatMap((cell) => cell.tokens),
  ...(token.rows ?? []).flat().flatMap((cell) => cell.tokens),
];

const HTML_ANCHOR = /<a\s+(?:id|name)="([^"]+)"/g;

export function docAnchors(markdown: string): Set<string> {
  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  const walk = (token: MdToken): void => {
    if (token.type === 'heading') anchors.add(slugger.slug(plainText(token)));
    if (token.type === 'html') {
      for (const m of token.raw.matchAll(HTML_ANCHOR)) anchors.add(m[1]);
    }
    children(token).forEach(walk);
  };
  (new Lexer({ gfm: true }).lex(markdown) as MdToken[]).forEach(walk);
  return anchors;
}

export function resolveDocPath(citedPath: string, fromDir: string, root: string): string | null {
  const path = citedPath.startsWith('/') ? join(root, citedPath) : join(fromDir, citedPath);
  return !relative(root, path).startsWith('..') && existsSync(path) ? path : null;
}
