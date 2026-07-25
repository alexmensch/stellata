// Shared cell + record-ref parsing for the Tier A corpus TSVs
// (known-stars.tsv, multi-star-regression.tsv, system-pair-topology.tsv).

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
