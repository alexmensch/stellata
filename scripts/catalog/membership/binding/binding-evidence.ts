// Loads the binding gate's evidence tables — Gaia G per source, the V
// cascade's three printed tiers, SIMBAD's WDS component cross-IDs.
// See ../../classic-ids/README.md#the-gates-evidence-has-to-be-pulled.

import { resolve } from 'node:path';

import type { GaiaAstrometryCatalogRow } from '../../distance/direction-cascade';
import { GAIA_ASTROMETRY } from '../../distance/gaia-astrometry-source';
import { HIP_PHOTOMETRY } from '../../photometry/hip-photometry-source';
import type { PrintedVLookups } from '../../photometry/v-magnitude-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../../util/paths';
import { bindingEvidence, parseSimbadWdsXidsTsv, type BindingEvidence } from './binding-gate-pure';

export const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');

const SIMBAD_HINT = 'run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.';

export function loadHipVMag(): Map<number, number> {
  return HIP_PHOTOMETRY.read().vmag;
}

/** The printed-V lookups come from the caller, built over the tables it
 *  already parsed, so a build reads each printed table once. Every other
 *  table is required: without it a join would key labels, or a manifest a
 *  binding, on sources the record build refuses. */
export function loadBindingEvidence(printedV: PrintedVLookups): {
  evidence: BindingEvidence;
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
} {
  const gaiaAstrometry = GAIA_ASTROMETRY.read();
  const wdsXids = parseSimbadWdsXidsTsv(readRequired(SRC_SIMBAD_WDS_XIDS, SIMBAD_HINT));
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  return { evidence: bindingEvidence(sourceGMag, wdsXids, printedV, gaiaAstrometry), gaiaAstrometry };
}
