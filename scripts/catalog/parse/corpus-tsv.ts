// Shared TSV header, cell and record-ref parsing for the build's committed
// tables and the Tier A corpora. See README.md § TSV header resolution.

/** Resolve a header line to a column → index map, throwing when any required
 *  column is absent.
 *
 *  An empty or headerless file therefore throws rather than reading as a
 *  zero-row table. Every caller's input is a committed (usually LFS) artifact,
 *  so "no rows" means truncated or unsmudged, never an empty dataset — and a
 *  parser that answers with an empty map turns a missing file into a silently
 *  zeroed join that only surfaces as a count drift much later. */
export function headerIndex(
  headerLine: string,
  cols: readonly string[],
  fileLabel: string,
  refreshHint: string,
): Record<string, number> {
  const header = headerLine.split('\t').map((h) => h.trim());
  const idx: Record<string, number> = Object.create(null);
  const missing: string[] = [];
  for (const c of cols) {
    const i = header.indexOf(c);
    if (i < 0) missing.push(c);
    idx[c] = i;
  }
  if (missing.length) {
    throw new Error(
      `${fileLabel} is missing required columns: ${missing.join(', ')}. ${refreshHint}`,
    );
  }
  return idx;
}

export function nonEmpty(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

export function parseFloatOrNull(s: string | undefined): number | null {
  const t = nonEmpty(s);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function parseIntOrNull(s: string | undefined): number | null {
  const v = parseFloatOrNull(s);
  return v === null ? null : Math.trunc(v);
}

/** How a corpus row addresses a catalog.bin record. */
export interface RecordRef {
  kind: 'hip' | 'gaia' | 'name';
  value: string;
}

export function parseRef(cell: string, rowName: string, col: string): RecordRef {
  const idx = cell.indexOf(':');
  const kind = idx > 0 ? cell.slice(0, idx) : '';
  const value = cell.slice(idx + 1).trim();
  if ((kind !== 'hip' && kind !== 'gaia' && kind !== 'name') || !value) {
    throw new Error(`${rowName}: malformed ${col} "${cell}" — expected hip:<n> | gaia:<id> | name:<name>`);
  }
  return { kind, value };
}

export function parseOptionalRef(
  cell: string | undefined,
  rowName: string,
  col: string,
): RecordRef | null {
  const t = nonEmpty(cell);
  return t === null ? null : parseRef(t, rowName, col);
}
