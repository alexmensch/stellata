// Codec for data/classic-ids/label_flips.tsv. See README.md.

import { byText, defineArtifact } from '../../../util/tsv/artifact-pure';
import { LABEL_DISPOSITIONS, LABEL_FIELDS, type LabelFlip } from './label-merge-pure';

export const LABEL_FLIPS_FILE = 'data/classic-ids/label_flips.tsv';

const rank = (flip: LabelFlip): number => LABEL_FIELDS.indexOf(flip.field);

const TIE_BREAKS = (['sourceId', 'disposition', 'applied', 'label', 'spine', 'overlay'] as const)
  .map((field) => byText((f: LabelFlip) => f[field]));

/** Field-major, then source_id, so a diff reads as "which rows changed
 *  disposition", not "which order the walk ran in". */
export const LABEL_FLIPS = defineArtifact({
  file: LABEL_FLIPS_FILE,
  columns: ['gaia_source_id', 'label', 'field', 'spine', 'overlay', 'applied', 'disposition'] as const,
  hint: 'Re-run `pnpm run build:membership`.',
  order: (a: LabelFlip, b: LabelFlip) => rank(a) - rank(b)
    || TIE_BREAKS.reduce((c, by) => c || by(a, b), 0),
  decode: (row): LabelFlip => ({
    sourceId: row.requiredSourceId('gaia_source_id'),
    label: row.raw('label'),
    field: row.oneOf('field', LABEL_FIELDS),
    spine: row.raw('spine'),
    overlay: row.raw('overlay'),
    applied: row.raw('applied'),
    disposition: row.oneOf('disposition', LABEL_DISPOSITIONS),
  }),
  encode: (f) => ({
    gaia_source_id: f.sourceId,
    label: f.label,
    field: f.field,
    spine: f.spine,
    overlay: f.overlay,
    applied: f.applied,
    disposition: f.disposition,
  }),
});
