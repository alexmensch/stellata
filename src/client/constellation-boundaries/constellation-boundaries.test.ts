import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildBoundaryArtifact,
  type BoundaryArtifact,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { CONSTELLATIONS, readIauEdgeRecords } from '../../../scripts/catalog/parse/constellations/constellations';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { makeFrameCtx } from '../scene/frame-ctx-mock';
import { unitVectorFromRaDec } from '../util/equatorial-basis';
import {
  ConstellationBoundaries,
  type ConstellationBoundariesDeps,
} from './constellation-boundaries';
import { createIauConstellationLookup } from './iau-geometry/iau-boundaries-pure';

// Bright stars sit 1–64 pc from their walls, the V 5 population 0.01–0.64 pc,
// so the fade window is [1, 4] pc at limit 0 and [0.02, 0.07] pc from limit 5.
const ARTIFACT: BoundaryArtifact = buildBoundaryArtifact(
  createIauConstellationLookup(readIauEdgeRecords()),
  [
    ...Array.from({ length: 64 }, (_, i) => ({ offsetPc: i + 1, appMag: 0 })),
    ...Array.from({ length: 64 }, (_, i) => ({ offsetPc: (i + 1) / 100, appMag: 5 })),
  ],
);

const BETELGEUSE = new THREE.Vector3().copy(unitVectorFromRaDec(5.919 * 15, 7.407)).multiplyScalar(150);

function build(patch: Partial<ConstellationBoundariesDeps> = {}) {
  const added: THREE.Object3D[] = [];
  const filterHandlers = new Set<() => void>();
  let limitMag = 6;
  const boundaries = new ConstellationBoundaries({
    scene: { add: (...objects: THREE.Object3D[]) => { added.push(...objects); return undefined as never; } },
    artifact: ARTIFACT,
    constellations: CONSTELLATIONS,
    uniforms: {
      uFovYRad: { value: Math.PI / 3.6 },
      uViewport: { value: new THREE.Vector2(1920, 1080) },
    },
    chromeLines: fakeChromeLineMaterials(),
    instrumentLimitMag: () => limitMag,
    onFilter: (handler) => {
      filterHandlers.add(handler);
      return () => { filterHandlers.delete(handler); };
    },
    permitted: () => true,
    localPositionInto: (_kind, _idx, out) => { out.copy(BETELGEUSE); return true; },
    worldOffset: new THREE.Vector3(),
    ...patch,
  });
  const group = added[0] as THREE.Group;
  return {
    boundaries, added, group, filterHandlers,
    setLimitMag: (m: number) => { limitMag = m; },
  };
}

describe('ConstellationBoundaries', () => {
  it('adds the arcs layer to the scene once, built from the artifact', () => {
    const { added, group } = build();
    expect(added).toHaveLength(1);
    expect(group.children).toHaveLength(1);
  });

  it('names a position in the Sol frame: local position plus the world offset', () => {
    const offset = new THREE.Vector3(3, -2, 1);
    const { boundaries } = build({
      worldOffset: offset,
      localPositionInto: (_kind, _idx, out) => { out.copy(BETELGEUSE).sub(offset); return true; },
    });
    expect(boundaries.constellationOf('planet', 0)).toBe('Orion');
  });

  it('names nothing for a position that does not resolve this frame', () => {
    const { boundaries } = build({ localPositionInto: () => false });
    expect(boundaries.constellationOf('cloud', 3)).toBeNull();
  });

  it('carries one label anchor per IAU region', () => {
    expect(build().boundaries.labelAnchors).toHaveLength(ARTIFACT.labels.length);
  });

  describe('with no artifact', () => {
    const { boundaries, group } = build({ artifact: null });

    it('names nothing and anchors nothing, for the whole session', () => {
      expect(boundaries.constellationOf('planet', 0)).toBeNull();
      expect(boundaries.labelAnchors).toEqual([]);
    });

    it('still registers a layer that draws nothing', () => {
      boundaries.entry.update?.(makeFrameCtx(new THREE.PerspectiveCamera()));
      expect(group.visible).toBe(false);
      expect(group.children).toHaveLength(0);
    });
  });

  it('declares itself static: nothing in a B1875 partition moves with t', () => {
    expect(build().boundaries.entry.timeBehaviour).toEqual({ kind: 'static' });
  });

  it('hides while the declutter floor refuses it', () => {
    const { boundaries, group } = build({ permitted: () => false });
    group.visible = true;
    boundaries.entry.update?.(makeFrameCtx(new THREE.PerspectiveCamera()));
    expect(group.visible).toBe(false);
  });

  it('re-reads the instrument limit on every filter push', () => {
    const { boundaries, group, filterHandlers, setLimitMag } = build();
    const at2pc = makeFrameCtx(new THREE.PerspectiveCamera(), { distFromSol: 2 });
    boundaries.entry.update?.(at2pc);
    expect(group.visible).toBe(false);
    setLimitMag(0);
    for (const handler of filterHandlers) handler();
    boundaries.entry.update?.(at2pc);
    expect(group.visible).toBe(true);
  });

  it('drops its filter subscription on dispose', () => {
    const { boundaries, filterHandlers } = build();
    expect(filterHandlers.size).toBe(1);
    boundaries.entry.dispose();
    expect(filterHandlers.size).toBe(0);
  });
});
