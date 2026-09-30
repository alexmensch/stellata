// Doc-figure markers: parse them, resolve each key against the count snapshots, render the figure.
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

export function parseFormat(token: string | undefined): FigureFormat | null {
  if (token === undefined) return { kind: 'exact' };
  const m = FORMAT.exec(token);
  if (!m) return null;
  return { kind: m[1] === 'sig' ? 'significant' : 'thousands', digits: Number(m[2]) };
}

export function parseMarkers(text: string): { markers: FigureMarker[]; problems: string[] } {
  const markers: FigureMarker[] = [];
  const problems: string[] = [];
  let consumed = 0;
  for (const open of text.matchAll(OPEN)) {
    const at = open.index;
    const line = lineAt(text, at);
    if (at < consumed) {
      problems.push(`line ${line}: marker opens inside another marker's figure`);
      continue;
    }
    const strayClose = text.slice(consumed, at).indexOf(CLOSE);
    if (strayClose !== -1) problems.push(`line ${lineAt(text, consumed + strayClose)}: ${CLOSE} with no open marker`);
    const bodyStart = at + open[0].length;
    const bodyEnd = text.indexOf(CLOSE, bodyStart);
    const format = parseFormat(open[2]);
    if (bodyEnd === -1) {
      problems.push(`line ${line}: count:${open[1]} is never closed`);
      consumed = text.length;
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

export function renderFigures(text: string, snapshots: Snapshots): FigureReport {
  const { markers, problems } = parseMarkers(text);
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
