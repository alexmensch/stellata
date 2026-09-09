// Loads the binding gate's evidence tables — Gaia G per source, the V
// cascade's three printed tiers, SIMBAD's WDS component cross-IDs.
// See README.md § The gate's evidence has to be pulled.

import { resolve } from 'node:path';

import { parseSimbadWdsXidsTsv } from '../record/catalog-pure';
import {
  parseGaiaAstrometryCatalogTsv,
  type GaiaAstrometryCatalogRow,
} from '../distance/direction-cascade';
import { parseGlieseTsv, lookupGliese } from '../gliese-parse';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { tycho2VMagnitude } from '../photometry/v-magnitude-pure';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';
import { bindingEvidence, type BindingEvidence } from './classic-id-overlay-pure';

export const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
export const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');
export const SRC_GLIESE = resolve(ROOT, 'data/gliese/gliese_v70a.tsv');
export const SRC_TYCHO2_MAIN = resolve(ROOT, 'data/tycho2/tycho2_main.tsv');
export const SRC_TYCHO2_SUPPL1 = resolve(ROOT, 'data/tycho2/tycho2_suppl1.tsv');

const ASTROMETRY_HINT = 'run `pnpm run refresh:gaia-astrometry-catalog`.';
export const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';
const SIMBAD_HINT = 'run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.';
const LFS_HINT = 'run `git lfs pull`.';

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
  const tycho2 = parseTycho2Tsvs(
    readRequired(SRC_TYCHO2_MAIN, LFS_HINT), readRequired(SRC_TYCHO2_SUPPL1, LFS_HINT),
  );
  const gliese = parseGlieseTsv(readRequired(SRC_GLIESE, LFS_HINT));
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  return {
    evidence: bindingEvidence(sourceGMag, hipVMag, wdsXids, gaiaAstrometry, {
      tycho2VOfTyc: (tyc) => {
        const row = tycho2.get(tyc);
        return row === undefined ? null : tycho2VMagnitude(row.btMag, row.vtMag).v;
      },
      glieseVOfGj: (gj) => lookupGliese(gliese, gj)?.vMag ?? null,
    }),
    gaiaAstrometry,
    hipVMag,
  };
}
