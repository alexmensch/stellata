// Test-only Catalog factory. Defaults: physicalRadius=1 Rsol,
// companion=-1, lumClass=255 (unknown), Apsis fields=NaN (NO_APSIS).

import { APSIS_FIELDS, type ApsisField } from '../../../scripts/catalog/catalog-pure';
import type { Catalog } from './catalog-loader';

function nanFloat32(count: number): Float32Array {
  const a = new Float32Array(count);
  a.fill(NaN);
  return a;
}

export function makeEmptyCatalog(count: number): Catalog {
  const apsis = {} as Record<ApsisField, Float32Array>;
  for (const name of APSIS_FIELDS) apsis[name] = nanFloat32(count);
  return {
    count,
    positions: new Float32Array(count * 3),
    velocities: new Float32Array(count * 3),
    absmag: new Float32Array(count),
    ci: new Float32Array(count),
    spectClass: new Float32Array(count),
    luminosityClass: new Uint8Array(count).fill(255),
    physicalRadius: new Float32Array(count).fill(1),
    constellation: new Float32Array(count),
    flags: new Uint8Array(count),
    companion: new Int32Array(count).fill(-1),
    periodDays: new Float32Array(count),
    amplitudeMag: new Float32Array(count),
    varType: new Uint8Array(count),
    hip: new Uint32Array(count),
    sid: new Uint32Array(count),
    gaiaSourceId: new BigUint64Array(count),
    multiplicityStatus: new Uint8Array(count),
    ...apsis,
    names: new Map(),
    solIndex: -1,
    constellations: [],
  };
}
