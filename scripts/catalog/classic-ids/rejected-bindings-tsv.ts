// Codec for data/classic-ids/rejected_bindings.tsv. See README.md#files-in-this-area.

import { compareSourceIdsNumeric } from '../astrometry-request/export-astrometry-request-pure';
import { defineArtifact, nullableCell } from '../../util/tsv/artifact-pure';
import { PRINTED_V_TIERS, type PrintedVVia } from '../photometry/v-magnitude-pure';

/** One overlay binding the gate refused, as the review file prints it. */
export interface RejectedBindingRow {
  sourceId: string;
  hip: number | null;
  vMag: number | null;
  vVia: PrintedVVia | null;
  gMag: number | null;
  reason: 'mag' | 'sibling';
  designations: string;
}

function compareHipNullsFirst(a: number | null, b: number | null): number {
  if (a === null || b === null) return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  return a - b;
}

const mag = (v: number | null): string => (v === null ? '' : v.toFixed(3));

export const REJECTED_BINDINGS = defineArtifact({
  file: 'data/classic-ids/rejected_bindings.tsv',
  columns: ['gaia_source_id', 'hip', 'v_mag', 'v_via', 'g_mag', 'reason', 'designations'] as const,
  hint: 'Re-run `pnpm run build:classic-ids`.',
  order: (a: RejectedBindingRow, b: RejectedBindingRow) =>
    compareHipNullsFirst(a.hip, b.hip) || compareSourceIdsNumeric(a.sourceId, b.sourceId),
  decode: (row): RejectedBindingRow => ({
    sourceId: row.raw('gaia_source_id'),
    hip: row.int('hip'),
    vMag: row.float('v_mag'),
    vVia: row.raw('v_via') === '' ? null : row.oneOf('v_via', PRINTED_V_TIERS),
    gMag: row.float('g_mag'),
    reason: row.oneOf('reason', ['mag', 'sibling'] as const),
    designations: row.raw('designations'),
  }),
  encode: (r) => ({
    gaia_source_id: r.sourceId,
    hip: nullableCell(r.hip),
    v_mag: mag(r.vMag),
    v_via: r.vVia ?? '',
    g_mag: mag(r.gMag),
    reason: r.reason,
    designations: r.designations,
  }),
});
