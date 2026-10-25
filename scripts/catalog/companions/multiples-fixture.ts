// Default-valued MultiplesTsvRow factory for catalog-pipeline tests.
// A module rather than a .test.ts export — see README.md#files-in-this-area.

import type { MultiplesTsvRow } from './companion-promotion';
import { parseStage6Offset } from './anchor-offset-pure';

/** `anchorOffset` defaults to what the parse boundary gives the row's own
 *  `comp` / `anchorComp` with blank offset cells. */
export function multiplesRow(overrides: Partial<MultiplesTsvRow> = {}): MultiplesTsvRow {
  const comp = overrides.comp ?? 'B';
  const anchorComp = overrides.anchorComp ?? null;
  return {
    systemId: 'WDS-1-AB',
    comp,
    hip: null,
    gaiaSourceId: null,
    x_pc: 100, y_pc: 0, z_pc: 0,
    absmag: 5.0, ci: 0.6, spect: '',
    name: '',
    source: 'wds',
    astrometryVia: 'gaia_5p',
    spectVia: 'none',
    photometryVia: 'athyg_own',
    orbitRole: 'secondary',
    distPc: 100,
    pDays: null,
    tJd: null,
    e: null,
    aAU: null,
    iRad: null,
    omegaRad: null,
    q: null,
    sepArcsec: null,
    paDeg: null,
    sepPaEpochJd: null,
    dmag: null,
    anchorComp,
    anchorOffset: parseStage6Offset(comp, anchorComp, null, null),
    magPri: null,
    magSec: null,
    ...overrides,
  };
}
