// Default-valued MultiplesTsvRow factory for catalog-pipeline tests.
// A module rather than a .test.ts export — see README.md#files-in-this-area.

import type { MultiplesTsvRow } from './companion-promotion';
import { parseStage6Offset } from './anchor-offset-pure';
import { OWN, gaiaFields, hipFields, type IdOrigin } from '../../binaries/multiples-record-pure';

type IdentifierKeys = 'gaiaSourceId' | 'gaiaOrigin' | 'hip' | 'hipOrigin';

/** A row's fields, its identifiers given bare; each binds under its `*Origin`, else as the row's own. */
export type MultiplesRowOverrides = Partial<Omit<MultiplesTsvRow, IdentifierKeys>> & {
  gaiaSourceId?: string | null;
  gaiaOrigin?: IdOrigin | null;
  hip?: number | null;
  hipOrigin?: IdOrigin | null;
};

/** `anchorOffset` defaults to what the parse boundary gives the row's own
 *  `comp` / `anchorComp` with blank offset cells. */
export function multiplesRow(overrides: MultiplesRowOverrides = {}): MultiplesTsvRow {
  const { gaiaSourceId, gaiaOrigin, hip, hipOrigin, ...rest } = overrides;
  const comp = overrides.comp ?? 'B';
  const anchorComp = overrides.anchorComp ?? null;
  return {
    systemId: 'WDS-1-AB',
    comp,
    hd: null,
    x_pc: 100, y_pc: 0, z_pc: 0,
    absmag: 5.0, ci: 0.6, spect: '',
    name: '',
    source: 'wds',
    regime: 0,
    resolveVia: 'unresolved',
    astrometryVia: 'gaia_5p',
    orbitVia: 'none',
    spectVia: 'none',
    photometryVia: 'athyg_own',
    aVia: 'none',
    orbitRole: 'secondary',
    distPc: 100,
    pDays: null,
    tJd: null,
    e: null,
    aAU: null,
    iRad: null,
    omegaRad: null,
    OmegaRad: null,
    q: null,
    sepArcsec: null,
    paDeg: null,
    sepPaEpochJd: null,
    dmag: null,
    anchorComp,
    anchorOffset: parseStage6Offset(comp, anchorComp, null, null),
    magPri: null,
    magSec: null,
    ...rest,
    ...gaiaFields(gaiaSourceId == null ? null : { value: gaiaSourceId, origin: gaiaOrigin ?? OWN }),
    ...hipFields(hip == null ? null : { value: hip, origin: hipOrigin ?? OWN }),
  };
}
