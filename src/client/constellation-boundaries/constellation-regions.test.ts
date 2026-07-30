import { describe, expect, it } from 'vitest';

import {
  buildBoundaryArtifact,
  type BoundaryArtifact,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { CONSTELLATIONS, readIauEdgeRecords } from '../../../scripts/catalog/parse/constellations';
import { SPHERE_RADIUS_PC } from '../galactic/coord-spheres/coord-sphere';
import { unitVectorFromRaDec } from '../util/equatorial-basis';
import {
  buildConstellationLabelAnchors,
  createConstellationNamer,
} from './constellation-regions';
import { createIauConstellationLookup } from './iau-boundaries-pure';

const lookup = createIauConstellationLookup(readIauEdgeRecords());
// The artifact the browser actually reads, built the way build:catalog builds
// it — an empty fade table is fine here, nothing below touches it.
const ARTIFACT: BoundaryArtifact = {
  ...buildBoundaryArtifact(lookup, [
    ...Array.from({ length: 64 }, (_, i) => ({ offsetPc: i + 1, appMag: 0 })),
    ...Array.from({ length: 64 }, (_, i) => ({ offsetPc: i + 1, appMag: 5 })),
  ]),
};

const namer = createConstellationNamer(ARTIFACT, CONSTELLATIONS);

function at(raHours: number, decDeg: number, distancePc = 100): string | null {
  const v = unitVectorFromRaDec(raHours * 15, decDeg);
  return namer.nameAt({ x: v.x * distancePc, y: v.y * distancePc, z: v.z * distancePc });
}

describe('the runtime constellation namer', () => {
  it('names the constellation a well-known direction sits in', () => {
    expect(at(5.919, 7.407)).toBe('Orion');          // Betelgeuse
    expect(at(2.530, 89.264)).toBe('Ursa Minor');     // Polaris
    expect(at(5.393, -69.756, 49_970)).toBe('Dorado'); // LMC
    expect(at(0.712, 41.269, 765_000)).toBe('Andromeda'); // M31
  });

  // Both Serpens parts are one constellation in the IAU-88 table, so the
  // membership answer never says "Caput" — that split is a label concern.
  it('collapses both Serpens parts onto the one constellation', () => {
    expect(at(15.695, 9.905)).toBe('Serpens');
    expect(at(18.163, -6.360)).toBe('Serpens');
  });

  // Sol has no direction, which is the one hole byte 34 leaves too.
  it('answers null at the origin', () => {
    expect(namer.nameAt({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  // The load-bearing property of shipping the grid rather than re-deriving it:
  // the runtime and the build answer one partition, not two that agree mostly.
  it('agrees with the build-time lookup across the whole sphere', () => {
    let checked = 0;
    for (let raHours = 0; raHours < 24; raHours += 0.37) {
      for (let decDeg = -89; decDeg <= 89; decDeg += 3.1) {
        const key = lookup.keyAt({ raDeg: raHours * 15, decDeg });
        expect(at(raHours, decDeg)).toBe(CONSTELLATIONS[
          CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === key)
        ].name);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
});

describe('chart label anchors', () => {
  const anchors = buildConstellationLabelAnchors(ARTIFACT, CONSTELLATIONS);

  it('carries one anchor per region, on the boundary sphere', () => {
    expect(anchors).toHaveLength(ARTIFACT.labels.length);
    for (const anchor of anchors) {
      expect(anchor.position.length()).toBeCloseTo(SPHERE_RADIUS_PC, 0);
      expect(anchor.name.length).toBeGreaterThan(0);
    }
  });

  // Two anchors, two DOM pool keys, one member-star gate — Serpens is one
  // constellation drawn in two places.
  it('gives Serpens two anchors sharing a name and a table index', () => {
    const serpens = anchors.filter((a) => a.name === 'Serpens');
    expect(serpens.map((a) => a.code).sort()).toEqual(['SER1', 'SER2']);
    expect(serpens[0].conIndex).toBe(serpens[1].conIndex);
    expect(new Set(anchors.map((a) => a.conIndex)).size).toBe(CONSTELLATIONS.length);
  });
});
