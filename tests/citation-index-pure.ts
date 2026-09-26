// Parsing for data/papers/index.md entries and manifest.json copies. Rules: /data/papers/README.md#cited-papers.

export interface IndexEntry {
  key: string;
  line: number;
  label: string;
  copy: string;
}

export interface PinnedCopy {
  file: string;
  source_url: string;
  sha256: string;
  bytes: number;
}

const ANCHOR = /^<a id="([^"]+)"><\/a>$/;
const HEADING = /^### (.+?) — /;
const COPY = /^- \*\*Copy:\*\* (.*)$/;
const NOT_HELD = /^(not held|unobtainable)\b/;

export function parseIndex(markdown: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const lines = markdown.split('\n');
  lines.forEach((text, i) => {
    const anchor = ANCHOR.exec(text);
    if (anchor) entries.push({ key: anchor[1], line: i + 1, label: HEADING.exec(lines[i + 1] ?? '')?.[1] ?? '', copy: '' });
    const copy = COPY.exec(text);
    if (copy && entries.length > 0) entries[entries.length - 1].copy = copy[1];
  });
  return entries;
}

export const holdsCopy = (entry: IndexEntry): boolean => entry.copy !== '' && !NOT_HELD.test(entry.copy);

const LABEL = /^(\p{L}[\p{L}'’.-]*(?: \p{L}[\p{L}'’.-]*)*) (\d{4})([a-z]?)$/u;
const INITIAL = /^\p{Lu}\.$/u;

export function labelDefects(entries: IndexEntry[]): string[] {
  const parsed = entries.map((entry) => ({ entry, m: LABEL.exec(entry.label) }));
  const bases = new Map<string, number>();
  for (const { m } of parsed) if (m) bases.set(`${m[1]} ${m[2]}`, (bases.get(`${m[1]} ${m[2]}`) ?? 0) + 1);
  return parsed.flatMap(({ entry: { key, label }, m }) => {
    if (!m || m[1].split(' ').some((word) => INITIAL.test(word) || word === 'et' || word === 'al.'))
      return [`${key}: "${label}" is not "<first author> <year>"`];
    const keyYear = /(\d{4})/.exec(key)?.[1];
    if (keyYear && keyYear !== m[2]) return [`${key}: "${label}" is dated ${m[2]}, its key ${keyYear}`];
    const shared = bases.get(`${m[1]} ${m[2]}`)! > 1;
    if (shared !== (m[3] !== '')) return [`${key}: "${label}" ${shared ? 'needs' : 'has'} a letter suffix`];
    return [];
  });
}

export interface Citation {
  key: string;
  line: number;
  text: string;
  form: 'link' | 'bare';
}

const LINK = /\[([^\]\n]*)\]\(\/data\/papers\/index\.md#([\w-]+)\)/g;
const BARE = /(?<!\]\()\/data\/papers\/index\.md#([\w-]+)/g;
const COMMENT_MARKER = /^\s*(?:\/\/+|#+|\*+|\/\*+|"""|''')?\s*/;
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

export function citationsIn(text: string): Citation[] {
  const links = [...text.matchAll(LINK)].map((m) => ({ key: m[2], line: lineOf(text, m.index), text: m[1], form: 'link' as const }));
  const bare = [...text.matchAll(BARE)].map((m) => ({
    key: m[1],
    line: lineOf(text, m.index),
    text: text
      .slice(Math.max(0, m.index - 240), m.index)
      .split('\n')
      .map((line) => line.replace(COMMENT_MARKER, ''))
      .join(' ')
      .replace(/\s+/g, ' '),
    form: 'bare' as const,
  }));
  return [...links, ...bare];
}

const BOLD = /^\*\*(.*)\*\*$/;

export const citesByLabel = ({ text, form }: Citation, label: string): boolean =>
  form === 'link'
    ? text.replace(BOLD, '$1') === label
    : [`${label} (`, `${label}'s (`, `(${label}, `].some((form) => text.endsWith(form));
