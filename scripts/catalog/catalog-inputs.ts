// Every file build-catalog.ts reads: the content-hash stamp's input set. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { closureWithSiblings } from '../util/import-closure-pure';
import { importClosure, trackedFiles } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import {
  HEAD_PATH, LEDGER_PATH, OVERRIDES_PATH, REINSTATEMENTS_PATH, RETIREMENTS_PATH,
} from '../sid/registry-io';
import { DESIGNATION_CONSTELLATION_INPUT_PATHS } from './classic-ids/apply-designation-constellation';
import { MULTIPLES_TSV } from './companions/companion-promotion';
import { STAR_NAMING_INPUT_PATHS } from './naming/apply-star-names';
import { STELLARIUM_SKYCULTURE_JSON } from './parse/constellations/constellations';
import { readStarsInputPaths } from './parse/read-stars-inputs';

export const CATALOG_BUILD_ENTRY = 'scripts/catalog/build-catalog.ts';

export const SRC_GCVS = resolve(REPO_ROOT, 'data/gcvs/gcvs5.txt');
export const SRC_GCVS_XREF = resolve(REPO_ROOT, 'data/gcvs/crossid.txt');
// GCVS keys on HIP and HD; this cross-walk is what lets a record carrying
// only a source_id still resolve a variable-star designation.
export const SRC_GAIA_HIP_XMATCH = resolve(REPO_ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
export const SRC_HIP_CCDM = resolve(REPO_ROOT, 'data/hipparcos/hip_ccdm.tsv');
export const SRC_SIMBAD_SAMPLE = resolve(REPO_ROOT, 'data/simbad/simbad_sample.tsv');

/** Absolute paths. */
export async function catalogInputPaths(): Promise<string[]> {
  const code = closureWithSiblings(await importClosure([CATALOG_BUILD_ENTRY]), trackedFiles());
  return [
    ...readStarsInputPaths(),
    ...DESIGNATION_CONSTELLATION_INPUT_PATHS,
    ...STAR_NAMING_INPUT_PATHS,
    STELLARIUM_SKYCULTURE_JSON, SRC_GCVS, SRC_GCVS_XREF, SRC_GAIA_HIP_XMATCH, SRC_HIP_CCDM,
    SRC_SIMBAD_SAMPLE, MULTIPLES_TSV,
    LEDGER_PATH, HEAD_PATH, OVERRIDES_PATH, RETIREMENTS_PATH, REINSTATEMENTS_PATH,
    ...code.map((path) => resolve(REPO_ROOT, path)),
  ];
}
