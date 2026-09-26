// Parsing for data/papers/index.md entries and manifest.json copies. Rules: /data/papers/README.md#cited-papers.

export interface ClaimRow {
  line: number;
  claim: string;
  value: string;
  status: string;
  page: string;
  passage: string;
}

export interface IndexEntry {
  key: string;
  line: number;
  label: string;
  copy: string;
  notes: string[];
  rows: ClaimRow[];
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
const NOTE = /^- \*\*Note:\*\* (.*)$/;
const NOT_HELD = /^(not held|unobtainable)\b/;
const TABLE_ROW = /^\| (?!Claim \|)/;
const CELL_SPLIT = /(?<!\\)\|/;

export function parseIndex(markdown: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const lines = markdown.split('\n');
  lines.forEach((text, i) => {
    const anchor = ANCHOR.exec(text);
    if (anchor) entries.push({ key: anchor[1], line: i + 1, label: HEADING.exec(lines[i + 1] ?? '')?.[1] ?? '', copy: '', notes: [], rows: [] });
    const entry = entries[entries.length - 1];
    if (!entry || anchor) return;
    const copy = COPY.exec(text);
    if (copy) entry.copy = copy[1];
    const note = NOTE.exec(text);
    if (note) entry.notes.push(note[1]);
    if (TABLE_ROW.test(text)) {
      const [claim = '', value = '', status = '', page = '', passage = ''] = text.split(CELL_SPLIT).slice(1, -1).map((c) => c.trim());
      entry.rows.push({ line: i + 1, claim, value, status, page, passage });
    }
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

const LINK = /\[([^\]]*)\]\(\/data\/papers\/index\.md#([\w-]+)\)/g;
const BARE = /(?<!\]\()\/data\/papers\/index\.md#([\w-]+)/g;
const COMMENT_MARKER = /^\s*(?:\/\/+|#+|\*+|\/\*+|"""|''')?\s*/;
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

export function citationsIn(text: string): Citation[] {
  const links = [...text.matchAll(LINK)].map((m) => ({ key: m[2], line: lineOf(text, m.index), text: m[1].replace(/\s+/g, ' '), form: 'link' as const }));
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

export const matchable = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

const QUOTED = /“([^”]*)”/g;
const ELISION = /\s*(?:…|\.\.\.|\[…\]|\[\.\.\.\])\s*/;
const MIN_FRAGMENT = 8;

export const quotedFragments = (passage: string): string[] =>
  [...passage.matchAll(QUOTED)]
    .flatMap((m) => m[1].split(ELISION))
    .map(matchable)
    .filter((fragment) => fragment.length >= MIN_FRAGMENT);

const PAGE = /\bpp?\.\s*([A-Za-z]?-?\d+|[ivxlc]+)(?:\s*[–-]\s*(\d+))?/g;
const LINE = /\bll?\.\s*(\d+)(?:\s*[–-]\s*(\d+))?/g;
const LINE_SLACK = 3;

function spans(field: string, pattern: RegExp): { first: string; last?: string }[] {
  return [...field.matchAll(pattern)].map((m) => ({ first: m[1], last: m[2] }));
}

export function pageLocators(field: string): Set<string> {
  const pages = new Set<string>();
  for (const { first, last } of spans(field, PAGE)) {
    if (!last || !/^\d+$/.test(first)) {
      pages.add(first);
      continue;
    }
    const lo = Number(first);
    const hi = Number(last.length < first.length ? first.slice(0, first.length - last.length) + last : last);
    for (let n = lo; n <= hi; n++) pages.add(String(n));
  }
  return pages;
}

export function lineLocators(field: string): Set<number> {
  const lines = new Set<number>();
  for (const { first, last } of spans(field, LINE))
    for (let n = Number(first) - LINE_SLACK; n <= Number(last ?? first) + LINE_SLACK; n++) lines.add(n);
  return lines;
}

interface PreparedPage {
  flat: string;
  edge: string;
}

export type CopyText =
  | { kind: 'paginated'; pagination: Pagination; layers: PreparedPage[][] }
  | { kind: 'lines'; flat: string; lineStarts: number[] }
  | { kind: 'unpaginated'; flat: string };

const EDGE_LINES = 4;

function preparePage(page: string): PreparedPage {
  const lines = page.split('\n').filter((line) => line.trim() !== '');
  return { flat: matchable(page), edge: [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)].join(' ') };
}

export type Pagination = { kind: 'pdf' } | { kind: 'printed' } | { kind: 'offset'; offset: number };

const OFFSET_FORWARD = /PDF page n is printed page (\d+) \+ n/;
const OFFSET_BACK = /PDF page n is printed page n − (\d+)/;

export function paginationOf(copy: string, printed: boolean): Pagination {
  const forward = OFFSET_FORWARD.exec(copy);
  if (forward) return { kind: 'offset', offset: Number(forward[1]) };
  const back = OFFSET_BACK.exec(copy);
  if (back) return { kind: 'offset', offset: -Number(back[1]) };
  return printed ? { kind: 'printed' } : { kind: 'pdf' };
}

export const paginatedText = (layers: string[], pagination: Pagination): CopyText => ({
  kind: 'paginated',
  pagination,
  layers: layers.map((layer) => layer.split('\f').map(preparePage)),
});

export function lineText(text: string): CopyText {
  const lineStarts: number[] = [];
  let flat = '';
  for (const line of text.split('\n')) {
    lineStarts.push(flat.length);
    flat += matchable(line);
  }
  return { kind: 'lines', flat, lineStarts };
}

export const unpaginatedText = (text: string): CopyText => ({ kind: 'unpaginated', flat: matchable(text) });

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

const printsPage = ({ edge }: PreparedPage, token: string): boolean =>
  new RegExp(`(?<![\\w.])${escapeRegExp(token)}(?![\\w])`).test(edge);

function offsets(flat: string, fragment: string): number[] {
  const at: number[] = [];
  for (let i = flat.indexOf(fragment); i !== -1; i = flat.indexOf(fragment, i + 1)) at.push(i);
  return at;
}

const notInCopy = (fragment: string) => `passage not in the copy: …${fragment.slice(0, 40)}…`;

export function passageDefect(row: ClaimRow, copy: CopyText): string | null {
  const fragments = quotedFragments(row.passage);
  if (!fragments.length) return 'verified, but quotes no passage from the copy';
  if (copy.kind === 'unpaginated') {
    const missing = fragments.find((fragment) => !copy.flat.includes(fragment));
    return missing === undefined ? null : notInCopy(missing);
  }
  if (copy.kind === 'lines') {
    const missing = fragments.find((fragment) => !copy.flat.includes(fragment));
    if (missing !== undefined) return notInCopy(missing);
    const wanted = lineLocators(row.page);
    if (!wanted.size) return `no line locator for a ReadMe copy: "${row.page}"`;
    const hits = offsets(copy.flat, fragments[0]).map((at) => copy.lineStarts.filter((start) => start <= at).length);
    return hits.some((n) => wanted.has(n)) ? null : `"${row.page}", but the passage is at l. ${hits.slice(0, 3).join(', ')}`;
  }
  const pagesWith = (fragment: string): number[] => [
    ...new Set(copy.layers.flatMap((pages) => pages.flatMap((page, i) => (page.flat.includes(fragment) ? [i] : [])))),
  ];
  const missing = fragments.find((fragment) => !pagesWith(fragment).length);
  if (missing !== undefined) return notInCopy(missing);
  const found = pagesWith(fragments[0]);
  const wanted = pageLocators(row.page);
  if (!wanted.size) return `no page locator: "${row.page}"`;
  const { pagination } = copy;
  const onWantedPage =
    pagination.kind === 'printed'
      ? found.some((i) => [...wanted].some((token) => copy.layers.some((pages) => pages[i] && printsPage(pages[i], token))))
      : found.some((i) => wanted.has(String(i + 1 + (pagination.kind === 'offset' ? pagination.offset : 0))));
  return onWantedPage ? null : `"${row.page}", but the passage is on PDF page ${found.map((i) => i + 1).slice(0, 3).join(', ')}`;
}

const DOI = /\b10\.\d{4,9}\/[^\s)\]>"'`,;]+/g;
const ARXIV = /\barXiv[: ]\s*\d{4}\.\d{4,5}|\bastro-ph\/\d{7}|\barxiv\.org\/abs\/\S+/gi;
const BIBCODE = /\b(?:1[89]|20)\d{2}[A-Za-z&][\w&.]{13}[A-Z.]\b/g;
const DATASET_DOI = /^10\.(?:5281|7910|26132|26093|5061|17876|25740)\//;
const VIZIER_BIBCODE = /yCat/;
const LITERAL = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;

export function uncitedIdentifiers(text: string): { line: number; identifier: string }[] {
  return text.split('\n').flatMap((raw, i) => {
    const prose = raw.replace(LITERAL, '');
    return [
      ...[...prose.matchAll(DOI)].map((m) => m[0]).filter((doi) => !DATASET_DOI.test(doi)),
      ...[...prose.matchAll(ARXIV)].map((m) => m[0]),
      ...[...prose.matchAll(BIBCODE)].map((m) => m[0]).filter((bibcode) => !VIZIER_BIBCODE.test(bibcode)),
    ].map((identifier) => ({ line: i + 1, identifier }));
  });
}

export const STATUSES = ['verified', 'unverified'];

const CODEBASE = /\b(?:tree|ships?|shipped|Stellata|our|the test)\b|\.(?:ts|py|tsv|md)\b|\b_?[A-Z]{2,}[A-Z0-9]*_[A-Z0-9_]{2,}\b/;

export function codebaseWording(entry: IndexEntry): string[] {
  const cells = [
    ...entry.rows.flatMap((row) => [
      { line: row.line, text: row.claim },
      { line: row.line, text: row.value },
    ]),
    ...entry.notes.map((text) => ({ line: entry.line, text })),
  ];
  return cells.flatMap(({ line, text }) => {
    const hit = CODEBASE.exec(text);
    return hit ? [`index.md:${line} ${entry.key} — "${hit[0]}" in "${text.slice(0, 60)}"`] : [];
  });
}
