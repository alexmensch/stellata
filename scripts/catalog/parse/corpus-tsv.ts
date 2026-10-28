// Record refs for the Tier A corpora. See README.md#files-in-this-area.

import { textCell } from '../../util/tsv/table-pure';

/** How a corpus row addresses a catalog.bin record. `hd` reaches the records
 *  the other three cannot: a no-Gaia astrometry-tier record carries no HIP, no
 *  source_id and no proper name, and HD is the only designation left. It
 *  resolves through the search index rather than the binary, which carries no
 *  HD column (the per-key indexes in `../catalog-lookup.ts`). */
export const RECORD_REF_KINDS = ['hip', 'gaia', 'name', 'hd'] as const;
export type RecordRefKind = (typeof RECORD_REF_KINDS)[number];

/** What each kind's value looks like, for the parse error. */
const REF_VALUE_SHAPE: Record<RecordRefKind, string> = {
  hip: 'n', gaia: 'id', name: 'name', hd: 'n',
};

export interface RecordRef {
  kind: RecordRefKind;
  value: string;
}

export function parseRef(cell: string, rowName: string, col: string): RecordRef {
  const idx = cell.indexOf(':');
  const kind = idx > 0 ? cell.slice(0, idx) : '';
  const value = cell.slice(idx + 1).trim();
  if (!(RECORD_REF_KINDS as readonly string[]).includes(kind) || !value) {
    throw new Error(
      `${rowName}: malformed ${col} "${cell}" — expected `
        + RECORD_REF_KINDS.map((k) => `${k}:<${REF_VALUE_SHAPE[k]}>`).join(' | '),
    );
  }
  return { kind: kind as RecordRefKind, value };
}

export function parseOptionalRef(
  cell: string | undefined,
  rowName: string,
  col: string,
): RecordRef | null {
  const t = textCell(cell);
  return t === null ? null : parseRef(t, rowName, col);
}
