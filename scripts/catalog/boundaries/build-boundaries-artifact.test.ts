import { describe, expect, it } from 'vitest';

import type { BoundaryArtifact } from '../../../src/catalog-format/boundaries/boundaries-artifact-pure';
import { boundaryArtifactSummary } from './build-boundaries-artifact';

describe('boundaryArtifactSummary', () => {
  it('states the counts, the size and the faintest fade row', () => {
    const artifact = {
      labels: [{}, {}],
      fade: { magLimits: [4, 6], quantilePcts: [50, 90], offsetsPc: [[1, 2], [0.125, 3.5]] },
    } as unknown as BoundaryArtifact;
    const counts = { boundarySegments: 781, boundaryDirections: 10110, boundaryRegionRuns: 2961, boundaryArtifactKb: 359 };
    expect(boundaryArtifactSummary({ json: '', bytes: 367_616, counts, artifact })).toBe(
      '(781 arcs, 10110 directions, 2 labels, 2961 region runs, 359.0 KB); fade window at V<=6: 50%=0.13 pc, 90%=3.50 pc',
    );
  });
});
