// Codec for the Vaidman 2025 (/data/papers/index.md#vaidman2025) supergiant reference table. See README.md.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';

export const ADOPTED_EDSD_NEW = 'EDSD_new';
export const ADOPTED_BJ_OLD = 'BJ_old';
const ADOPTED = [ADOPTED_EDSD_NEW, ADOPTED_BJ_OLD] as const;
export type Adopted = (typeof ADOPTED)[number];

export interface VaidmanRow {
  readonly name: string;
  readonly dBjPaperPc: number;
  readonly sigmaDBjPaperPc: number;
  readonly ruwe: number;
  readonly gMag: number;
  readonly dNewPc: number;
  readonly sigmaDNewPc: number;
  readonly snrTot: number;
  readonly priorScalePc: number;
  /** Which of the paper's distances is the reference: its new EDSD posterior or Bailer-Jones's own. */
  readonly adopted: Adopted;
  readonly gaiaSourceId: string;
}

const NUMERIC = {
  d_bj_paper_pc: 'dBjPaperPc',
  sigma_d_bj_paper_pc: 'sigmaDBjPaperPc',
  ruwe: 'ruwe',
  g_mag: 'gMag',
  d_new_pc: 'dNewPc',
  sigma_d_new_pc: 'sigmaDNewPc',
  snr_tot: 'snrTot',
  prior_scale_pc: 'priorScalePc',
} as const satisfies Record<string, keyof VaidmanRow>;

type NumericColumn = keyof typeof NUMERIC;
const NUMERIC_COLUMNS = Object.keys(NUMERIC) as NumericColumn[];

export const VAIDMAN_SUPERGIANTS = defineArtifact({
  file: DATA_FILES.vaidmanSupergiants,
  columns: ['name', ...NUMERIC_COLUMNS, 'adopted', 'gaia_source_id'] as const,
  hint: 'Rebuild it from the paper PDF with `pnpm run build:vaidman-table` (/data/distance-validation/README.md).',
  order: 'as-given',
  decode: (row): VaidmanRow => {
    const required = (column: NumericColumn): number => {
      const v = row.float(column);
      if (v === null) throw new Error(`${DATA_FILES.vaidmanSupergiants}: empty ${column} for ${row.raw('name')}`);
      return v;
    };
    return {
      name: row.raw('name'),
      ...Object.fromEntries(NUMERIC_COLUMNS.map((c) => [NUMERIC[c], required(c)])) as Record<(typeof NUMERIC)[NumericColumn], number>,
      adopted: row.oneOf('adopted', ADOPTED),
      gaiaSourceId: row.requiredSourceId('gaia_source_id'),
    };
  },
  encode: (r) => ({
    name: r.name,
    ...Object.fromEntries(NUMERIC_COLUMNS.map((c) => [c, r[NUMERIC[c]].toFixed(3)])) as Record<NumericColumn, string>,
    adopted: r.adopted,
    gaia_source_id: r.gaiaSourceId,
  }),
});
