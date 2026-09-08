// Loads the binding gate's three evidence tables — Gaia G per source, printed
// HIP V, SIMBAD's WDS component cross-IDs. See README.md § The gate's evidence
// has to be pulled.

import { resolve } from 'node:path';

import { parseSimbadWdsXidsTsv } from '../catalog-pure';
import {
  parseGaiaAstrometryCatalogTsv,
  type GaiaAstrometryCatalogRow,
} from '../distance/direction-cascade';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';
import { bindingEvidence, type BindingEvidence } from './classic-id-overlay-pure';

export const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
export const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');

const ASTROMETRY_HINT = 'run `pnpm run refresh:gaia-astrometry-catalog`.';
export const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';
const SIMBAD_HINT = 'run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.';

export interface LoadedBindingEvidence {
  evidence: BindingEvidence;
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
  hipVMag: Map<number, number>;
}

/** Every table is required: without them a join would key labels, or a manifest
 *  a binding, on sources the record build refuses, so a missing one hard-fails
 *  rather than degrading. */
export function loadBindingEvidence(): LoadedBindingEvidence {
  const gaiaAstrometry = parseGaiaAstrometryCatalogTsv(
    readRequired(SRC_GAIA_ASTROMETRY, ASTROMETRY_HINT),
  );
  const { vmag: hipVMag } = parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT));
  const wdsXids = parseSimbadWdsXidsTsv(readRequired(SRC_SIMBAD_WDS_XIDS, SIMBAD_HINT));
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  return {
    evidence: bindingEvidence(sourceGMag, hipVMag, wdsXids, gaiaAstrometry),
    gaiaAstrometry,
    hipVMag,
  };
}
