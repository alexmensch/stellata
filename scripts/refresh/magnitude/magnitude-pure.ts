// The magnitude-bounded selection: every gaia_source row at G <= 11, sliced on G. See README.md.

import { ASTROMETRY_COLUMNS, GAIA_SOURCE, astrometrySpot } from '../gaia-request/gaia-request-pure';
import { near } from '../pull/gates-pure';
import type { PullTable, SlicedScope } from '../pull/pull';
import { GAIA_SLICE_ROWS } from '../pull/tap-pure';
import { MAGNITUDE_EDGES } from './magnitude-edges';

/** Why the floor carries no margin: /data/gaia/README.md#why-the-floor-carries-no-margin. */
export const G_MAG_FLOOR = 11;

/** The bound and its slices on `column`, the G magnitude as the query names it. */
export const magnitudeBound = (column: string): { readonly where: string; readonly scope: SlicedScope } => ({
  where: `${column} <= ${G_MAG_FLOOR}`,
  scope: { kind: 'sliced', key: column, edges: MAGNITUDE_EDGES, sliceRows: GAIA_SLICE_ROWS },
});

/** eta UMa, the brightest row, carries a 2-parameter solution: null parallax, motion and RUWE. */
const ETA_UMA = astrometrySpot('1576683529448755328', null, 1.731607, {
  ruwe: null, phot_bp_mean_mag: near(2.46912, 0.0001), phot_rp_mean_mag: near(2.130753, 0.0001),
});

/** The brightest row, Barnard's Star (shared with the catalogue astrometry, and an rv), and the faintest row the floor admits. */
export const MAGNITUDE_TABLE: PullTable = {
  from: GAIA_SOURCE,
  columns: ASTROMETRY_COLUMNS,
  sortBy: [{ column: 'source_id', as: 'integer' }],
  ...magnitudeBound('phot_g_mean_mag'),
  band: { min: 1_222_000, max: 1_273_000 },
  spotRows: [
    ETA_UMA,
    astrometrySpot('4472832130942575872', [546.9759, -801.551, 10362.3942], 8.193974, { radial_velocity: near(-110.4682, 0.001) }),
    astrometrySpot('5878248887353382016', [1.274, 5.6308, -3.9074], 10.999999, { radial_velocity: near(-20.0825, 0.001) }),
  ],
};
