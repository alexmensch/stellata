// Test-only Catalog factory. Defaults: physicalRadius=1 Rsol,
// companion=-1, lumClass=255 (unknown), Apsis fields=NaN (NO_APSIS).

import { APSIS_FIELDS, type ApsisField } from '../../../scripts/catalog/record/catalog-pure';
import { buildPulsationParams } from '../star-pipeline/pulsation/pulsation-params-pure';
import type { Catalog, CompleteCatalog } from './catalog-loader';

function nanFloat32(count: number): Float32Array {
  const a = new Float32Array(count);
  a.fill(NaN);
  return a;
}

export function assumeComplete(catalog: Catalog): CompleteCatalog {
  if (catalog.loadedCount !== catalog.count) {
    throw new Error(`assumeComplete on ${catalog.loadedCount} of ${catalog.count} records`);
  }
  return catalog as CompleteCatalog;
}

export interface MockCatalog extends Catalog {
  /** Land every remaining record and settle `whenComplete`. */
  complete(): void;
}

/** `loadedCount` defaults to the whole catalogue; pass fewer to express a
 *  progressive load mid-flight, and raise it on the returned object to land
 *  a chunk (`./README.md#progressive-catalog-load`). */
export function makeEmptyCatalog(count: number, loadedCount = count): MockCatalog {
  const apsis = {} as Record<ApsisField, Float32Array>;
  for (const name of APSIS_FIELDS) apsis[name] = nanFloat32(count);
  const varType = new Uint8Array(count);
  const { rho: pulsRho, colorSwing: pulsColorSwing } = buildPulsationParams(varType);
  let settle!: () => void;
  const whenComplete = new Promise<void>((resolve) => { settle = resolve; })
    .then(() => assumeComplete(catalog));
  const catalog: MockCatalog = {
    count,
    loadedCount,
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
    varType,
    pulsRho,
    pulsColorSwing,
    hip: new Uint32Array(count),
    sid: new Uint32Array(count),
    gaiaSourceId: new BigUint64Array(count),
    multiplicityStatus: new Uint8Array(count),
    ...apsis,
    names: new Map(),
    solIndex: -1,
    constellations: [],
    sidSuccessors: new Map(),
    onRecordsDecoded: () => () => {},
    whenComplete,
    complete() {
      catalog.loadedCount = count;
      settle();
    },
  };
  if (loadedCount === count) settle();
  return catalog;
}
