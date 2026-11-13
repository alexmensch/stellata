// `pnpm run build:clouds`. See README.md.

import { codeCount } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { allocateSibling, emitSibling, siblingLineage } from '../sid/sibling-allocation';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { sweepStaged } from '../util/emit-artifacts';
import { buildClouds, cloudsPayload, zuckerProfiledPayload } from './build-clouds-pure';
import { CLOUDS_JSON } from './clouds-json';
import { CLOUDS_OUTPUTS } from './clouds-outputs';
import { profiledClouds } from './cloud-model-pure';
import { ZUCKER_2020, ZUCKER_2021_EXTENTS, ZUCKER_2021_FITS, ZUCKER_2021_MASSES } from './zucker-source';

export async function main(): Promise<void> {
  sweepStaged(CLOUDS_OUTPUTS);
  const extents = ZUCKER_2021_EXTENTS.read();
  const masses = ZUCKER_2021_MASSES.read();
  const profiled = profiledClouds(extents, ZUCKER_2021_FITS.read(), masses);
  const { clouds, ellipsoids, spheres } = buildClouds({ sightlines: ZUCKER_2020.read(), extents, masses, profiled });

  const spec = SIBLING_ARTIFACTS.clouds;
  const allocation = allocateSibling(spec, CLOUDS_JSON, clouds);
  const lineage = siblingLineage(spec, allocation);
  emitSibling(CLOUDS_OUTPUTS, {
    clouds: CLOUDS_JSON.serialize(cloudsPayload(clouds, allocation.sids)),
    zuckerProfiled: `${JSON.stringify(zuckerProfiledPayload(profiled), null, 2)}\n`,
  }, allocation, lineage);
  console.log(
    `wrote ${CLOUDS_JSON.file} (${ellipsoids} ellipsoids from Z2021, ${spheres} spheres from Z2020, `
      + `${clouds.length} total; ${codeCount(spec.codes, lineage.counts)('minted')} cloud SIDs minted) `
      + `and ${profiled.length} profiled clouds' column-check inputs`,
  );
}

