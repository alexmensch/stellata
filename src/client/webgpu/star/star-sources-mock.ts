// StarLayerSources over zero-filled arrays, for tests that need the real
// source attributes without a device.

import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import { CATALOG_BOUNDING_RADIUS_PC } from '../../star-pipeline/shards/star-shards-pure';
import { buildStarSourceAttributes } from '../../star-pipeline/star-source-attributes';
import type { StarLayerSources } from './star-tables';

export function makeStarLayerSources(count = 4): {
  sources: StarLayerSources;
  arrays: {
    localPositions: Float32Array;
    compositeSuppress: Float32Array;
    eclipseDim: Float32Array;
    suppressPulsation: Float32Array;
  };
} {
  const arrays = {
    localPositions: new Float32Array(count * 3),
    compositeSuppress: new Float32Array(count),
    eclipseDim: new Float32Array(count).fill(1),
    suppressPulsation: new Float32Array(count),
  };
  return {
    arrays,
    sources: {
      catalog: makeEmptyCatalog(count),
      logRadii: new Float32Array(count),
      lumClassF32: new Float32Array(count),
      distSol: new Float32Array(count),
      teffApsis: new Float32Array(count),
      boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
      ...buildStarSourceAttributes(arrays),
    },
  };
}

/** A renderer that records compute dispatches and storage releases — what
 *  the layer touches outside construction. */
export function makeFakeStarRenderer() {
  const dispatches: unknown[][] = [];
  const released: unknown[] = [];
  return {
    dispatches,
    released,
    renderer: {
      compute: (nodes: unknown) => dispatches.push(Array.isArray(nodes) ? nodes : [nodes]),
      getArrayBufferAsync: (a: { array: ArrayBufferView }) =>
        Promise.resolve(a.array.buffer.slice(0) as ArrayBuffer),
      _attributes: { delete: (a: unknown) => released.push(a) },
    },
  };
}
