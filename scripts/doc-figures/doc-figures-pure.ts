// Doc-figure markers: parse them, resolve each key against the count snapshots, render the figure.
import { Lexer, walkTokens } from 'marked';
import { roundSignificant } from '../util/frozen-json';

export type FigureFormat =
  | { kind: 'exact' }
  | { kind: 'significant'; digits: number }
  | { kind: 'thousands'; digits: number };

export interface FigureMarker {
  key: string;
  format: FigureFormat;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  line: number;
}

/** Snapshot stem (`membership-manifest` for `membership-manifest-expected.json`) → parsed JSON. */
export type Snapshots = ReadonlyMap<string, unknown>;

export type Resolution = { ok: true; value: number } | { ok: false; reason: string };

export interface FigureReport {
  rendered: string;
  problems: string[];
  stale: string[];
}

export const SNAPSHOT_SUFFIX = '-expected.json';

const OPEN = /<!-- count:(\S+?)(?: (\S+))? -->/g;
const CLOSE = '<!-- /count -->';
const FORMAT = /^(sig|k)([1-9])$/;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/** A token's raw text as a source pattern: inside a list item or blockquote the lexer strips each continuation line's indent and `>`. */
const sourcePattern = (raw: string): RegExp =>
  new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n[ \\t>]*'), 'g');

/** Markdown with every code block and inline code span blanked to spaces, newlines and offsets kept. */
export function maskCode(markdown: string): string {
  let masked = markdown;
  let cursor = 0;
  walkTokens(new Lexer({ gfm: true }).lex(markdown), (token) => {
    if (token.type !== 'code' && token.type !== 'codespan') return;
    const pattern = sourcePattern(token.raw);
    pattern.lastIndex = cursor;
    const found = pattern.exec(markdown);
    if (!found) throw new Error(`code token not found in source after offset ${cursor}: ${token.raw.slice(0, 40)}`);
    cursor = found.index + found[0].length;
    masked = masked.slice(0, found.index) + found[0].replace(/[^\n]/g, ' ') + masked.slice(cursor);
  });
  return masked;
}

export function parseFormat(token: string | undefined): FigureFormat | null {
  if (token === undefined) return { kind: 'exact' };
  const m = FORMAT.exec(token);
  if (!m) return null;
  return { kind: m[1] === 'sig' ? 'significant' : 'thousands', digits: Number(m[2]) };
}

export function parseMarkers(text: string): { markers: FigureMarker[]; problems: string[] } {
  const markers: FigureMarker[] = [];
  const problems: string[] = [];
  const opens = [...text.matchAll(OPEN)];
  let consumed = 0;
  for (const [i, open] of opens.entries()) {
    const at = open.index;
    const line = lineAt(text, at);
    const strayClose = text.slice(consumed, at).indexOf(CLOSE);
    if (strayClose !== -1) problems.push(`line ${lineAt(text, consumed + strayClose)}: ${CLOSE} with no open marker`);
    const bodyStart = at + open[0].length;
    const bodyEnd = text.indexOf(CLOSE, bodyStart);
    const format = parseFormat(open[2]);
    if (bodyEnd === -1 || bodyEnd > (opens[i + 1]?.index ?? Infinity)) {
      problems.push(`line ${line}: count:${open[1]} is never closed`);
      consumed = bodyStart;
      continue;
    }
    consumed = bodyEnd + CLOSE.length;
    const body = text.slice(bodyStart, bodyEnd);
    if (body.includes('\n')) problems.push(`line ${line}: count:${open[1]} spans a line break`);
    else if (format === null) problems.push(`line ${line}: count:${open[1]} has unknown format '${open[2]}'`);
    else markers.push({ key: open[1], format, body, bodyStart, bodyEnd, line });
  }
  const trailingClose = text.indexOf(CLOSE, consumed);
  if (trailingClose !== -1) problems.push(`line ${lineAt(text, trailingClose)}: ${CLOSE} with no open marker`);
  return { markers, problems };
}

/** `<stem>/<dot.path>`: the stem names the snapshot file, the path walks its JSON. */
export function resolveFigure(key: string, snapshots: Snapshots): Resolution {
  const slash = key.indexOf('/');
  if (slash === -1) return { ok: false, reason: `'${key}' has no '/' between snapshot and path` };
  const stem = key.slice(0, slash);
  if (!snapshots.has(stem)) return { ok: false, reason: `no snapshot ${stem}${SNAPSHOT_SUFFIX}` };
  let node: unknown = snapshots.get(stem);
  for (const part of key.slice(slash + 1).split('.')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) {
      return { ok: false, reason: `${stem}${SNAPSHOT_SUFFIX} has no ${key.slice(slash + 1)}` };
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'number') return { ok: false, reason: `${key} is not a number` };
  return { ok: true, value: node };
}

const grouped = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 20 });

export function formatFigure(value: number, format: FigureFormat): string {
  switch (format.kind) {
    case 'exact':
      return grouped(value);
    case 'significant':
      return grouped(roundSignificant(value, format.digits));
    case 'thousands':
      return `${grouped(roundSignificant(value / 1000, format.digits))}k`;
  }
}

export type DocKind = 'markdown' | 'html';

export const scannable = (text: string, kind: DocKind): string => (kind === 'markdown' ? maskCode(text) : text);

export function renderFigures(text: string, snapshots: Snapshots, kind: DocKind): FigureReport {
  const { markers, problems } = parseMarkers(scannable(text, kind));
  const stale: string[] = [];
  let rendered = '';
  let cursor = 0;
  for (const m of markers) {
    const resolved = resolveFigure(m.key, snapshots);
    if (!resolved.ok) {
      problems.push(`line ${m.line}: ${resolved.reason}`);
      continue;
    }
    const figure = formatFigure(resolved.value, m.format);
    if (figure !== m.body) stale.push(`line ${m.line}: count:${m.key} quotes ${m.body}, snapshot gives ${figure}`);
    rendered += text.slice(cursor, m.bodyStart) + figure;
    cursor = m.bodyEnd;
  }
  return { rendered: rendered + text.slice(cursor), problems, stale };
}

const SIZE_FIGURE = /(?<![\d.,_])\d{3}(?:[,_]\d{3}|k)(?![\d,_]*\d)/g;
const SIZE_CONTEXT = /\bstars?\b|\brecords?\b|catalog|\binstances?\b|\bpositions?\b/i;
const WHOLE_MARKER = /<!-- count:\S+?(?: \S+)? -->[^\n]*?<!-- \/count -->/g;

export interface SizeFigure {
  figure: string;
  line: number;
}

const figureValue = (figure: string): number =>
  figure.endsWith('k') ? Number(figure.slice(0, -1)) * 1000 : Number(figure.replace(/[,_]/g, ''));

/** Unmarked figures in the catalogue's size range, on a line about stars, records or the catalogue. */
export function catalogueSizeFigures(scannableText: string, range: readonly [number, number]): SizeFigure[] {
  const found: SizeFigure[] = [];
  scannableText
    .replace(WHOLE_MARKER, (m) => ' '.repeat(m.length))
    .split('\n')
    .forEach((text, i) => {
      if (!SIZE_CONTEXT.test(text)) return;
      for (const m of text.matchAll(SIZE_FIGURE)) {
        const v = figureValue(m[0]);
        if (v >= range[0] && v <= range[1]) found.push({ figure: m[0], line: i + 1 });
      }
    });
  return found;
}

/** The only unmarked catalogue sizes a surface that cannot hold a marker may quote. */
export const markerlessSizeForms = (recordCount: number): string[] => [
  formatFigure(recordCount, { kind: 'significant', digits: 2 }),
  formatFigure(recordCount, { kind: 'thousands', digits: 2 }),
];

export const SIZE_EXEMPTION_REASONS = ['stale', 'history', 'other-count'] as const;

export interface SizeExemption {
  file: string;
  figure: string;
  reason: (typeof SIZE_EXEMPTION_REASONS)[number];
}

const isReason = (r: string): r is SizeExemption['reason'] => (SIZE_EXEMPTION_REASONS as readonly string[]).includes(r);

/** `<file>\t<figure>\t<reason>` per line; blank lines and `#` lines are skipped. */
export function parseSizeExemptions(text: string): SizeExemption[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .map((l) => {
      const [file, figure, reason] = l.split('\t');
      if (!file || !figure || reason === undefined || !isReason(reason)) {
        throw new Error(`size exemption needs <file>\\t<figure>\\t<${SIZE_EXEMPTION_REASONS.join('|')}>: ${l}`);
      }
      return { file, figure, reason };
    });
}
