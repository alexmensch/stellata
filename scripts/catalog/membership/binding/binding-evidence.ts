// Loads the binding gate's evidence tables — Gaia G per source, the V
// cascade's three printed tiers, SIMBAD's WDS component cross-IDs.
// See ../../classic-ids/README.md#the-gates-evidence-has-to-be-pulled.

import { resolve } from 'node:path';

import {
  parseGaiaAstrometryCatalogTsv,
  type GaiaAstrometryCatalogRow,
} from '../../distance/direction-cascade';
import { parseHipPhotometryTsv } from '../../photometry/hip-photometry-parse';
import type { PrintedVLookups } from '../../photometry/v-magnitude-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../../util/paths';
import { bindingEvidence, parseSimbadWdsXidsTsv, type BindingEvidence } from './binding-gate-pure';

export const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
export const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');

const ASTROMETRY_HINT = 'run `pnpm run refresh:gaia-astrometry-catalog`.';
const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';
const SIMBAD_HINT = 'run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.';

export function loadHipVMag(): Map<number, number> {
  return parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT)).vmag;
}

/** The printed-V lookups come from the caller, built over the tables it
 *  already parsed, so a build reads each printed table once. Every other
 *  table is required: without it a join would key labels, or a manifest a
 *  binding, on sources the record build refuses. */
export function loadBindingEvidence(printedV: PrintedVLookups): {
  evidence: BindingEvidence;
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
} {
  const gaiaAstrometry = parseGaiaAstrometryCatalogTsv(
    readRequired(SRC_GAIA_ASTROMETRY, ASTROMETRY_HINT),
  );
  const wdsXids = parseSimbadWdsXidsTsv(readRequired(SRC_SIMBAD_WDS_XIDS, SIMBAD_HINT));
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  return { evidence: bindingEvidence(sourceGMag, wdsXids, printedV, gaiaAstrometry), gaiaAstrometry };
}
