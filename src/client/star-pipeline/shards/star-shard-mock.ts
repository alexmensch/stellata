// Test-only StarShard factory. Defaults: an LMC-like field of 2 stars,
// 5 kpc bounding radius about a chunk origin 50 kpc down +x.

import type { StarShard } from './star-shards-pure';

export function makeShard(overrides: Partial<StarShard> = {}): StarShard {
  return {
    key: 'lmc',
    count: 2,
    positions: new Float32Array([0.5, 0, 0, -1, 2, 3]),
    chunkOrigin: [50_000, 0, 0],
    boundingRadiusPc: 5_000,
    sid: new Uint32Array([900, 901]),
    ...overrides,
  };
}
