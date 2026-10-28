// Codec for data/membership/label-drops.tsv. See README.md#the-unattested-labels-leave-the-row.

import { defineArtifact } from '../../util/tsv/artifact-pure';

export const LABEL_DROPS_FILE = 'data/membership/label-drops.tsv';
export const LABEL_DROP_COLUMNS = [
  'tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'cell', 'value', 'reason',
] as const;
export type LabelDropRow = Record<(typeof LABEL_DROP_COLUMNS)[number], string>;
/** The label-parity reasons (/docs/catalog-driver.md#62-label-parity) a spine label leaves the manifest: no primary publishes
 *  that Flamsteed number, or that HD number, for the star. */
export const LABEL_DROP_REASONS = ['flamsteed_unattested', 'hd_unattested'] as const;
export type LabelDropReason = (typeof LABEL_DROP_REASONS)[number];

export const LABEL_DROPS = defineArtifact({
  file: LABEL_DROPS_FILE,
  columns: LABEL_DROP_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): LabelDropRow => {
    row.oneOf('reason', LABEL_DROP_REASONS);
    return row.cells();
  },
  encode: (r) => r,
});
