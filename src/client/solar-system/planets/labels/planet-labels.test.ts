import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPlanetLabels } from './planet-labels';
import type { Stellata } from '../../../stellata';

interface FakeEl {
  style: { display: string };
  setAttribute(): void;
  remove(): void;
  textContent: string;
}

function withDocument<T>(group: object, run: () => T): T {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const prevWin = (globalThis as { window?: unknown }).window;
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => (id === 'planet-labels' ? group : null),
    createElementNS: (): FakeEl => ({
      style: { display: '' },
      setAttribute: () => {},
      remove: () => {},
      textContent: '',
    }),
  };
  (globalThis as { window?: unknown }).window = { innerWidth: 800, innerHeight: 800 };
  try {
    return run();
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
    (globalThis as { window?: unknown }).window = prevWin;
  }
}

describe('createPlanetLabels — sentinel-init', () => {
  it('writes display:none synchronously on init', () => {
    // First-load regression: planet-labels group has no inline `display:
    // none` in index.html, so it starts visible. A boolean visibility
    // sentinel initialised to `false` matches `setGroupVisible(false)` and
    // the first-call write silently no-ops — the empty group then paints
    // at SVG defaults until a non-matching toggle. The dirty-attr `\0`
    // poison sentinel forces the write through. Same shape as the
    // heliopause first-load fix (/docs/authoring-patterns.md#sentinel-init-for-dirty-track).
    const group = { style: { display: '' } };
    withDocument(group, () => {
      const stellata = {
        on: () => () => {},
        focus: { getFocusedPlanetSystem: () => null },
      } as unknown as Stellata;
      createPlanetLabels(stellata);
    });
    expect(group.style.display).toBe('none');
  });
});

describe('createPlanetLabels — the OBSERVE anchor body', () => {
  const HOST = 0;
  const ps = { hostStarIdx: HOST, planets: [{ name: 'Venus' }, { name: 'Earth' }] };
  const camera = new THREE.PerspectiveCamera(60, 1, 1e-6, 10);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();

  function run(observeAnchorFlat: number | null, placeable = (_flat: number) => true): string[] {
    const els: FakeEl[] = [];
    const group = { style: { display: '' }, appendChild: (el: FakeEl) => els.push(el) };
    return withDocument(group, () => {
      let onFrame = (): void => {};
      const stellata = {
        on: (ev: string, fn: () => void) => {
          if (ev === 'frame') onFrame = fn;
          return () => {};
        },
        focus: { getFocusedPlanetSystem: () => ps },
        observe: {
          observeAnchorOf: (kind: string) => (kind === 'planet' ? observeAnchorFlat : null),
        },
        kinds: {
          planet: {
            field: {
              planetIdxWithin: (host: number, flat: number | null) =>
                host === HOST ? flat : null,
              instanceIndexOf: (_h: number, i: number) => i,
              planetLocalPositionInto: (flat: number, out: THREE.Vector3) => {
                out.set(0.1 * flat, 0, 0);
                return placeable(flat);
              },
              eclipseDimForInstance: () => 1,
            },
          },
        },
        getMonochrome: () => false,
        declutter: { permits: () => true },
        solarSystem: {
          orbitRings: { isOrbitRingResolvable: () => true },
        },
        camera,
        occluders: { hides: () => false },
      } as unknown as Stellata;
      createPlanetLabels(stellata);
      onFrame();
      return els.map((e) => e.style.display);
    });
  }

  it('labels every resolvable body when OBSERVE stands on none', () => {
    expect(run(null)).toEqual(['', '']);
  });

  it('hides the anchor body’s label while its body is still drawn', () => {
    expect(run(1)).toEqual(['', 'none']);
  });

  it('hides the label of a body the field cannot place', () => {
    expect(run(null, (flat) => flat !== 0)).toEqual(['none', '']);
  });
});
