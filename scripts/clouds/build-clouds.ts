// `pnpm run build:clouds`. See README.md.

import { existsSync, statSync } from 'node:fs';

import { allocateSibling, emitSibling } from '../sid/sibling-allocation';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { runStep, sweepStaged } from '../util/emit-artifacts';
import { stepInputPaths } from '../util/step-inputs';
import { buildClouds, cloudsPayload, zuckerProfiledPayload } from './build-clouds-pure';
import { CLOUDS_OUTPUTS } from './clouds-outputs';
import { profiledClouds } from './cloud-model-pure';
import { ZUCKER_2020, ZUCKER_2021_EXTENTS, ZUCKER_2021_FITS, ZUCKER_2021_MASSES } from './zucker-source';

const ARTIFACTS = [CLOUDS_OUTPUTS.files.clouds, CLOUDS_OUTPUTS.files.zuckerProfiled];

async function isUpToDate(): Promise<boolean> {
  if (!ARTIFACTS.every(existsSync)) return false;
  const oldest = Math.min(...ARTIFACTS.map((p) => statSync(p).mtimeMs));
  for (const src of await stepInputPaths('build:clouds')) {
    if (!existsSync(src) || statSync(src).mtimeMs > oldest) return false;
  }
  return true;
}

async function main(): Promise<void> {
  sweepStaged(CLOUDS_OUTPUTS);
  if (!process.argv.includes('--force') && await isUpToDate()) {
    console.log(`${SIBLING_ARTIFACTS.clouds.file} up to date — skipping (use --force to rebuild)`);
    return;
  }

  const extents = ZUCKER_2021_EXTENTS.read();
  const masses = ZUCKER_2021_MASSES.read();
  const profiled = profiledClouds(extents, ZUCKER_2021_FITS.read(), masses);
  const { clouds, ellipsoids, spheres } = buildClouds({ sightlines: ZUCKER_2020.read(), extents, masses, profiled });

  const allocation = allocateSibling(SIBLING_ARTIFACTS.clouds, clouds);
  emitSibling(CLOUDS_OUTPUTS, {
    clouds: `${JSON.stringify(cloudsPayload(clouds, allocation.sids))}\n`,
    zuckerProfiled: `${JSON.stringify(zuckerProfiledPayload(profiled), null, 2)}\n`,
  }, allocation);
  console.log(
    `wrote ${SIBLING_ARTIFACTS.clouds.file} (${ellipsoids} ellipsoids from Z2021, ${spheres} spheres from Z2020, `
      + `${clouds.length} total; ${allocation.minted} cloud SIDs minted) and ${profiled.length} profiled clouds' column-check inputs`,
  );
}

runStep(main);
