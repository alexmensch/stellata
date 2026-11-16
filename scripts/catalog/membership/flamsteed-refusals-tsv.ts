// Codec for data/membership/flamsteed-refusals.tsv. See /scripts/catalog/simbad/README.md#the-refused-numbers.

import { ascending, compareCodeUnits } from '../../../src/astro-core/order-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineArtifact } from '../../util/tsv/artifact-pure';
import type { FlamsteedRefusalRow } from '../simbad/flamsteed-refusals-pure';
import { FLAMSTEED_REFUSALS } from '../simbad/simbad-flamsteed-pure';

export const FLAMSTEED_REFUSAL_LEDGER = defineArtifact({
  file: DATA_FILES.flamsteedRefusals,
  columns: ['simbad_oid', 'hip', 'hd', 'designation', 'reason', 'evidence'],
  hint: 'Re-run `pnpm run build:membership`.',
  order: (a: FlamsteedRefusalRow, b: FlamsteedRefusalRow) => ascending(a.simbadOid, b.simbadOid) || compareCodeUnits(a.designation, b.designation),
  decode: (row): FlamsteedRefusalRow => ({
    simbadOid: row.requiredId('simbad_oid'),
    hip: row.raw('hip'),
    hd: row.raw('hd'),
    designation: row.raw('designation'),
    reason: row.oneOf('reason', FLAMSTEED_REFUSALS),
    evidence: row.raw('evidence'),
  }),
  encode: (r) => ({
    simbad_oid: String(r.simbadOid), hip: r.hip, hd: r.hd, designation: r.designation, reason: r.reason, evidence: r.evidence,
  }),
});
