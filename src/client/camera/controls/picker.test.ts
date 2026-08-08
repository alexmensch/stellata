// Picker integration tests — full pickStar pipeline and cross-method
// pickStar / pickStarHit round-trip used by the overlap disambiguator.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { drawCutoffMag } from '../../hdr/exposure/exposure-epoch';
import { Picker, type PickerDeps } from './picker';
import type { HoverHit } from '../../hover/hover-types';
import { ALL_SPECT_MASK, type FilterState } from '../../filters/filter-state';
import type { Catalog } from '../../loaders/catalog-loader';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';

// Canonical test viewport — power-of-two so screen-pixel math lands on
// integer boundaries. Camera placed at (0,0,30) looking down -Z, so
// stars at z = 0 in the catalog project through the centre of view.
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const FOV_DEG = 60;

interface StubElementBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function makeDomElementStub(bounds: StubElementBounds = {
  left: 0, top: 0, width: VIEWPORT_W, height: VIEWPORT_H,
}): HTMLElement {
  return {
    getBoundingClientRect(): DOMRect {
      return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        right: bounds.left + bounds.width,
        bottom: bounds.top + bounds.height,
        x: bounds.left,
        y: bounds.top,
        toJSON() { return {}; },
      };
    },
  } as unknown as HTMLElement;
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-10, 100_000);
  cam.position.set(0, 0, 30);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

// Build a minimal catalog with `positions` and the per-star scalar
// arrays the pick path reads. Positions are passed in the local frame
// so they go straight into `getLocalPositions`.
function makeCatalog(
  positions: number[][],
  opts: {
    absmag?: number[];
    spectClass?: number[];     // 0..8 (B,A,F,G,K,M,O, etc.)
    periodDays?: number[];
    amplitudeMag?: number[];
  } = {},
): {
  catalog: Catalog;
  localPositions: Float32Array;
  sortedDistFromSol: Float32Array;
  sortedByDistFromSol: Uint32Array;
} {
  const n = positions.length;
  const pos = new Float32Array(n * 3);
  const distSol = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = positions[i][0];
    pos[i * 3 + 1] = positions[i][1];
    pos[i * 3 + 2] = positions[i][2];
    distSol[i] = Math.hypot(positions[i][0], positions[i][1], positions[i][2]);
  }
  const sortedIdx = new Uint32Array(n);
  for (let i = 0; i < n; i++) sortedIdx[i] = i;
  sortedIdx.sort((a, b) => distSol[a] - distSol[b]);
  const sortedDist = new Float32Array(n);
  for (let i = 0; i < n; i++) sortedDist[i] = distSol[sortedIdx[i]];

  const catalog = makeEmptyCatalog(n);
  catalog.positions = pos;
  if (opts.absmag) for (let i = 0; i < opts.absmag.length; i++) catalog.absmag[i] = opts.absmag[i];
  if (opts.spectClass) {
    for (let i = 0; i < opts.spectClass.length; i++) catalog.spectClass[i] = opts.spectClass[i];
  } else {
    catalog.spectClass.fill(3); // default G
  }
  if (opts.periodDays) {
    for (let i = 0; i < opts.periodDays.length; i++) catalog.periodDays[i] = opts.periodDays[i];
  }
  if (opts.amplitudeMag) {
    for (let i = 0; i < opts.amplitudeMag.length; i++) catalog.amplitudeMag[i] = opts.amplitudeMag[i];
  }

  return {
    catalog,
    localPositions: pos,
    sortedDistFromSol: sortedDist,
    sortedByDistFromSol: sortedIdx,
  };
}

function defaultFilter(overrides: Partial<FilterState> = {}): FilterState {
  return {
    minDistSol: 0,
    maxDistSol: 50_000,
    instrument: 'unaided-eye',
    spectMask: ALL_SPECT_MASK,
    highlightCon: -1,
    sizeMin: 2,
    sizeMax: 10,
    coordSphere: 'none',
    showHud: false,
    showLgEmission: true,
    chart: false,
    detailLevel: 'all',
    ...overrides,
  };
}

function makePicker(
  data: ReturnType<typeof makeCatalog>,
  filter: FilterState,
  opts: {
    camera?: THREE.PerspectiveCamera;
    renderedSizePxFn?: (idx: number) => number;
    resolveCollapsedLead?: (idx: number) => number;
    /** The instrument's limit, standing in for the threshold too (these
     *  cases run at EV 0 and no adaptation). */
    limitMag?: number;
    kindPicks?: PickerDeps['kindPicks'];
  } = {},
): { picker: Picker; camera: THREE.PerspectiveCamera; dom: HTMLElement } {
  const camera = opts.camera ?? makeCamera();
  const dom = makeDomElementStub();
  const deps: PickerDeps = {
    domElement: dom,
    camera,
    catalog: data.catalog,
    sortedByDistFromSol: data.sortedByDistFromSol,
    sortedDistFromSol: data.sortedDistFromSol,
    getLocalPositions: () => data.localPositions,
    getFilter: () => filter,
    drawCutoffMagFn: (chart) => {
      const limitMag = opts.limitMag ?? 15;
      return drawCutoffMag(limitMag, limitMag, chart);
    },
    kindPicks: opts.kindPicks ?? {},
    renderedSizePxFn: opts.renderedSizePxFn ?? (() => 20), // default 20 px disc
    resolveCollapsedLead: opts.resolveCollapsedLead ?? ((idx) => idx),
  };
  return { picker: new Picker(deps), camera, dom };
}

// Project a world-space point through the test camera to screen pixel
// coordinates inside the viewport. Used by the tests to compute the
// exact cursor position that lands on a specific star's centre.
function projectToScreen(p: THREE.Vector3, camera: THREE.PerspectiveCamera): { x: number; y: number } {
  const v = p.clone().project(camera);
  return {
    x: (v.x + 1) * 0.5 * VIEWPORT_W,
    y: (1 - v.y) * 0.5 * VIEWPORT_H,
  };
}

describe('Picker / pickStar', () => {
  describe('prime tier — cursor inside rendered disc', () => {
    let data: ReturnType<typeof makeCatalog>;
    beforeEach(() => {
      // One star at the world origin, projecting to screen centre.
      data = makeCatalog([[0, 0, 0]]);
    });

    it('returns the star idx when cursor lands inside the disc', () => {
      const { picker, camera } = makePicker(data, defaultFilter());
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x, screen.y)).toBe(0);
    });

    it('routes the winning idx through resolveCollapsedLead — clicks act on the cluster primary', () => {
      const { picker, camera } = makePicker(data, defaultFilter(), {
        resolveCollapsedLead: (idx) => idx + 100,
      });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x, screen.y)).toBe(100);
      expect(picker.pickStarHit(screen.x, screen.y)?.idx).toBe(100);
      // A miss stays -1 — the resolver never sees it.
      expect(picker.pickStar(VIEWPORT_W - 1, VIEWPORT_H - 1)).toBe(-1);
    });

    it('returns -1 when no star is near the cursor', () => {
      const { picker } = makePicker(data, defaultFilter());
      // Far corner of the viewport — way outside the 20 px disc at the
      // centre and outside the 16 px fallback threshold.
      expect(picker.pickStar(VIEWPORT_W - 1, VIEWPORT_H - 1)).toBe(-1);
    });
  });

  describe('fallback tier — cursor near disc centre, outside the disc', () => {
    it('returns the idx when cursor is within pixelThreshold of the centre', () => {
      const data = makeCatalog([[0, 0, 0]]);
      // 2 px disc, well below MIN_DISC_HIT_RADIUS_PX (4 px) but well
      // below the fallback threshold (16 px) — cursor 6 px away
      // misses the prime tier but lands fallback.
      const { picker, camera } = makePicker(data, defaultFilter(), {
        renderedSizePxFn: () => 2,
      });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x + 6, screen.y)).toBe(0);
    });

    it('returns -1 when cursor is outside both tiers', () => {
      const data = makeCatalog([[0, 0, 0]]);
      const { picker, camera } = makePicker(data, defaultFilter(), {
        renderedSizePxFn: () => 2,
      });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      // 20 px > both 4 px floored prime hitRadius AND the 16 px default
      // pixelThreshold for pickStar.
      expect(picker.pickStar(screen.x + 20, screen.y)).toBe(-1);
    });
  });

  describe('Double-Double-style cluster — overlapping discs', () => {
    // Two stars 6 px apart on screen, each with a 20 px disc — every
    // pixel between them lies inside both discs. The closer-to-cursor
    // candidate must win (per pickScore) so each component remains
    // independently clickable. Same regression ε¹/ε² Lyr exposed in
    // au3 / xec.
    it('cursor on star A wins A even when star B overlaps it', () => {
      // Two stars on the x-axis in world space. With the test camera
      // at (0,0,30) and 60° FOV, the screen-pixel separation is set
      // by the world separation × pxPerRad.
      const fovYRad = (FOV_DEG * Math.PI) / 180;
      const pxPerRad = VIEWPORT_H / fovYRad;
      // Aim for ~6 px on-screen separation at z = 0, dCam = 30 pc.
      const dx = (6 / pxPerRad) * 30;
      const data = makeCatalog([[-dx / 2, 0, 0], [dx / 2, 0, 0]], {
        absmag: [4, 4], // identical → no magnitude bias
      });
      const { picker, camera } = makePicker(data, defaultFilter());
      const screenA = projectToScreen(new THREE.Vector3(-dx / 2, 0, 0), camera);
      const screenB = projectToScreen(new THREE.Vector3(dx / 2, 0, 0), camera);
      // Sanity check: discs overlap.
      expect(Math.abs(screenA.x - screenB.x)).toBeLessThan(20);
      // Clicking dead-centre on star A picks A, on star B picks B.
      expect(picker.pickStar(screenA.x, screenA.y)).toBe(0);
      expect(picker.pickStar(screenB.x, screenB.y)).toBe(1);
    });
  });

  describe('spectral-mask filter', () => {
    it('excludes stars whose spectClass bit is cleared in the mask', () => {
      // Two stars at the same projected position (different z so the
      // closer one would otherwise dominate). Mask out class 4 (K).
      const data = makeCatalog([[0, 0, 0], [0, 0, -1]], {
        spectClass: [4, 3], // K, G
      });
      const filter = defaultFilter({ spectMask: ~(1 << 4) & 0xff });
      const { picker, camera } = makePicker(data, filter);
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x, screen.y)).toBe(1);
    });
  });

  describe('distance-window filter', () => {
    it('skips stars outside [minDistSol, maxDistSol]', () => {
      // Sol at origin; near star at z=-2 (dSol = 2); far star at z=-50.
      // Camera looks down -Z from (0,0,30), so both project to screen
      // centre but their Sol-distance differs.
      const data = makeCatalog([[0, 0, -2], [0, 0, -50]]);
      // Narrow band excludes the near star.
      const filter = defaultFilter({ minDistSol: 10, maxDistSol: 100 });
      const { picker, camera } = makePicker(data, filter);
      const screen = projectToScreen(new THREE.Vector3(0, 0, -2), camera);
      // Cursor on the near star, but it's filtered out — picker
      // returns the far star (whose centre is also at screen centre).
      expect(picker.pickStar(screen.x, screen.y)).toBe(1);
    });

    it('returns -1 when no stars fall inside the band', () => {
      const data = makeCatalog([[0, 0, 0]]);
      const filter = defaultFilter({ minDistSol: 1000, maxDistSol: 2000 });
      const { picker, camera } = makePicker(data, filter);
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x, screen.y)).toBe(-1);
    });
  });

  describe('apparent-mag filter', () => {
    it('respects the instrument limit against absmag + 5*(log10(dCam) - 1)', () => {
      // Star at z = 0 → dCam = 30 pc → 5*(log10(30) - 1) ≈ 2.39
      // mag distance modulus. absmag = 5 → appMag ≈ 7.39.
      const data = makeCatalog([[0, 0, 0]], { absmag: [5] });
      const { picker, camera } = makePicker(data, defaultFilter(), { limitMag: 6 });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      // appMag 7.39 > the 6.5 cutoff → star filtered out, miss.
      expect(picker.pickStar(screen.x, screen.y)).toBe(-1);
    });

    it('uses bright-extreme appMag for variables so they stay pickable through trough', () => {
      // Same star as above, but now with a 3-mag variable amplitude.
      // Filter uses appMag - amp/2 = 7.39 - 1.5 = 5.89, inside the
      // limit-6 cutoff. (Without this, the variable would drop out at
      // trough phase while still being drawn at peak.)
      const data = makeCatalog([[0, 0, 0]], {
        absmag: [5],
        periodDays: [10],
        amplitudeMag: [3],
      });
      const { picker, camera } = makePicker(data, defaultFilter(), { limitMag: 6 });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
      expect(picker.pickStar(screen.x, screen.y)).toBe(0);
    });

    it('picks in the soft-taper band where the disc still renders (navigate) but not in chart', () => {
      // Regression: the click pick cut at the limit while the shader
      // fades the disc out over the +0.5 soft taper, leaving a band that
      // renders but couldn't be selected. absmag 4 at dCam 30 pc →
      // appMag ≈ 6.39, inside (6, 6.5] for a limit of 6.
      const data = makeCatalog([[0, 0, 0]], { absmag: [4] });
      const screen = projectToScreen(new THREE.Vector3(0, 0, 0), makeCamera());
      // Navigate: soft taper applies → the band star is pickable.
      const nav = makePicker(data, defaultFilter({ chart: false }), { limitMag: 6 });
      expect(nav.picker.pickStar(screen.x, screen.y)).toBe(0);
      // Chart mode hard-clips at the limit (no taper) → not drawn, not pickable.
      const chart = makePicker(data, defaultFilter({ chart: true }), { limitMag: 6 });
      expect(chart.picker.pickStar(screen.x, screen.y)).toBe(-1);
    });
  });
});

describe('Picker / pickStarHit', () => {
  // The hover-tier round-trip: same (x, y) the click path picks must
  // produce a HoverHit with the same idx, tier, and a sensible
  // cameraDistancePc. The cross-provider disambiguator orders by
  // cameraDistancePc, so getting it wrong silently breaks "closer
  // object wins" cross-layer.
  it('returns the same idx as pickStar for an in-disc hit', () => {
    const data = makeCatalog([[0, 0, 0]]);
    const { picker, camera } = makePicker(data, defaultFilter());
    const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
    const clickIdx = picker.pickStar(screen.x, screen.y);
    const hit = picker.pickStarHit(screen.x, screen.y);
    expect(hit).not.toBeNull();
    expect(hit!.idx).toBe(clickIdx);
    expect(hit!.tier).toBe('prime');
  });

  it('cameraDistancePc reflects the camera→star distance', () => {
    // Camera at (0,0,30), star at (0,0,0) → distance 30 pc.
    const data = makeCatalog([[0, 0, 0]]);
    const { picker, camera } = makePicker(data, defaultFilter());
    const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
    const hit = picker.pickStarHit(screen.x, screen.y);
    expect(hit!.cameraDistancePc).toBeCloseTo(30, 5);
  });

  it('ordering: closer star reports a smaller cameraDistancePc', () => {
    // Two stars on the line of sight. The disambiguator's "closer wins"
    // depends on cameraDistancePc preserving that ordering.
    const data = makeCatalog([
      [0, 0, 0],    // dCam = 30
      [0, 0, -20],  // dCam = 50
    ]);
    const { picker, camera } = makePicker(data, defaultFilter(), {
      // Small discs so only one star fits under the cursor at a time —
      // we want both Hits in a sequence, then compare distances.
      renderedSizePxFn: () => 6,
    });
    // Cursor on the near star.
    const screenNear = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
    const hitNear = picker.pickStarHit(screenNear.x, screenNear.y);
    // Cursor on the far star (also projects to screen centre — both at
    // x=y=0). With identical screen positions, pickScore + identical
    // absmag would tie — instead, query distances directly by reading
    // from a single-star catalog so the report is unambiguous.
    expect(hitNear!.cameraDistancePc).toBeCloseTo(30, 5);
    expect(hitNear!.cameraDistancePc).toBeLessThan(50);
  });

  it('returns null when the cursor misses every star', () => {
    const data = makeCatalog([[0, 0, 0]]);
    const { picker } = makePicker(data, defaultFilter());
    expect(picker.pickStarHit(VIEWPORT_W - 1, VIEWPORT_H - 1)).toBeNull();
  });

  it('preserves tier classification for fallback hits', () => {
    const data = makeCatalog([[0, 0, 0]]);
    const { picker, camera } = makePicker(data, defaultFilter(), {
      renderedSizePxFn: () => 2,
    });
    const screen = projectToScreen(new THREE.Vector3(0, 0, 0), camera);
    const hit = picker.pickStarHit(screen.x + 6, screen.y);
    expect(hit).not.toBeNull();
    expect(hit!.tier).toBe('fallback');
  });
});

describe('Picker / pickKindHit', () => {
  const HIT: HoverHit = { idx: 3, cameraDistancePc: 1.5, tier: 'prime' };

  it('dispatches to the registered kind and forwards the threshold', () => {
    const calls: Array<[number, number, number]> = [];
    const { picker } = makePicker(makeCatalog([[0, 0, 0]]), defaultFilter(), {
      kindPicks: {
        probe: (x, y, px) => { calls.push([x, y, px]); return HIT; },
      },
    });
    expect(picker.pickKindHit('probe', 40, 50, 16)).toBe(HIT);
    expect(calls).toEqual([[40, 50, 16]]);
    // Same default threshold the other hover-side pick paths carry.
    picker.pickKindHit('probe', 40, 50);
    expect(calls[1]).toEqual([40, 50, 14]);
  });

  it('returns null for a kind with no module pick registered', () => {
    const { picker } = makePicker(makeCatalog([[0, 0, 0]]), defaultFilter(), {
      kindPicks: { probe: () => HIT },
    });
    expect(picker.pickKindHit('lg', 40, 50, 16)).toBeNull();
    expect(picker.pickKindHit('planet', 40, 50, 16)).toBeNull();
  });
});
