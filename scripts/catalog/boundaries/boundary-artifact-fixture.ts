// Test-only: the smallest BoundaryArtifact that clears the load-time
// validator, so a test exercising one field doesn't hand-write the rest.

import { IAU_REGION_COUNT } from '../../../src/client/constellation-boundaries/iau-boundaries-pure';
import type { BoundaryArtifact } from './boundaries-artifact-pure';

/** Shape only — synthetic region codes and a 2 × 2 grid. Anything reading the
 *  real geometry builds from `readIauEdgeRecords` instead. */
export function boundaryArtifactFixture(
  overrides: Partial<BoundaryArtifact> = {},
): BoundaryArtifact {
  return {
    epoch: 'B1875',
    frame: 'ICRS',
    stepDeg: 0.5,
    segments: [{ k: 'M', c: ['DEL', 'AQL'], d: [1, 0, 0, 0, 1, 0] }],
    labels: Array.from({ length: IAU_REGION_COUNT }, (_, i) => ({
      c: `R${i}`,
      d: [1, 0, 0] as [number, number, number],
      a: 100,
    })),
    regions: {
      raDeg: [0, 180],
      decDeg: [0],
      codes: ['R0', 'R1'],
      runs: [1, 0, 1, 1, 2, 0],
    },
    fade: {
      magLimits: [6, 8],
      quantilePcts: [0.1, 1, 5, 50],
      offsetsPc: [[0.14, 0.4, 0.9, 7], [0.31, 0.6, 1.5, 10]],
      sampleCounts: [3000, 20000],
    },
    ...overrides,
  };
}
