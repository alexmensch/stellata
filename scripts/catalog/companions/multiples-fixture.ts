// Default-valued MultiplesTsvRow factory for catalog-pipeline tests.
// A module rather than a .test.ts export — see README.md § Files in this area.

import type { MultiplesTsvRow } from './companion-promotion';

export function multiplesRow(overrides: Partial<MultiplesTsvRow> = {}): MultiplesTsvRow {
  return {
    systemId: 'WDS-1-AB',
    comp: 'B',
    hip: null,
    gaiaSourceId: null,
    hd: null,
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
    anchorSepArcsec: null,
    anchorPaDeg: null,
    magPri: null,
    magSec: null,
    ...overrides,
  };
}
