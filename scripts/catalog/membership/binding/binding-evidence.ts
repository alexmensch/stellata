// Loads the binding gate's evidence tables — Gaia G per source, the V
// cascade's three printed tiers, SIMBAD's WDS component cross-IDs.
// See ../../classic-ids/README.md#the-gates-evidence-has-to-be-pulled.

import type { GaiaAstrometryRow } from '../../sources/gaia-astrometry-source';
import { GAIA_ASTROMETRY } from '../../sources/gaia-astrometry-source';
import { HIP_PHOTOMETRY } from '../../photometry/hip-photometry-source';
import type { PrintedHipValue } from '../../photometry/hip-photometry-parse-pure';
import type { PrintedVLookups } from '../../photometry/v-magnitude-pure';
import { bindingEvidence, parseSimbadWdsXidsTsv, type BindingEvidence, type SimbadWdsXidIndex } from './binding-gate-pure';
import { SIMBAD_WDS_XIDS } from './simbad-wds-xids-source';
import { HIP2 } from '../../sources/hip2-source';
import type { PositionEvidence } from './binding-derivation-pure';

export function loadHipVMag(): Map<number, PrintedHipValue> {
  return HIP_PHOTOMETRY.read().vmag;
}

/** The printed-V lookups come from the caller, built over the tables it
 *  already parsed, so a build reads each printed table once. Every other
 *  table is required: without it a join would key labels, or a manifest a
 *  binding, on sources the record build refuses. */
export function loadBindingEvidence(printedV: PrintedVLookups): {
  evidence: BindingEvidence;
  gaiaAstrometry: Map<string, GaiaAstrometryRow>;
  wdsXids: SimbadWdsXidIndex;
} {
  const gaiaAstrometry = GAIA_ASTROMETRY.read();
  const wdsXids = parseSimbadWdsXidsTsv(SIMBAD_WDS_XIDS.read());
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  return { evidence: bindingEvidence(sourceGMag, wdsXids, printedV, gaiaAstrometry), gaiaAstrometry, wdsXids };
}

/** HIP2's J1991.25 positions and Gaia's, for the identity witness. */
export function positionEvidence(gaiaAstrometry: ReadonlyMap<string, GaiaAstrometryRow>): PositionEvidence {
  const hip2 = HIP2.read().astrometry;
  return {
    hipparcos: (hip) => hip2.get(hip) ?? null,
    gaia: (sourceId) => {
      const row = gaiaAstrometry.get(sourceId);
      if (row === undefined || row.pmraMasyr === null || row.pmdecMasyr === null) return null;
      return {
        raDeg: row.raDeg, decDeg: row.decDeg, refEpoch: row.refEpoch,
        pmRaMasyr: row.pmraMasyr, pmDecMasyr: row.pmdecMasyr,
      };
    },
  };
}
