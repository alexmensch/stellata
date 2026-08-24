import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  ChartLabels,
  CHART_LAYER_IDS,
  computeAppMag,
  collides,
  measureCandidate,
  filterByDistAndSpect,
  projectVecInto,
  starLabelOffsetPx,
  type Candidate,
} from './chart-labels';
import type { Stellata } from '../stellata';
import type { ChartModeContext } from './chart-mode';

describe('chart-labels / computeAppMag', () => {
  it('equals absmag at exactly 10 pc (distance modulus = 0)', () => {
    // Distance modulus is m - M = 5(log10(d) - 1). At d=10 pc, modulus=0,
    // so apparent magnitude == absolute magnitude. This is the definition
    // of absmag and a load-bearing identity for any chart-mode brightness
    // gate.
    const positions = new Float32Array([10, 0, 0]);
    const absmag = new Float32Array([4.83]);
    expect(computeAppMag(0, positions, absmag)).toBeCloseTo(4.83, 5);
  });

  it('is dimmer (larger magnitude) at greater distance', () => {
    const absmag = new Float32Array([4.83]);
    const near = computeAppMag(0, new Float32Array([5, 0, 0]), absmag);
    const far = computeAppMag(0, new Float32Array([100, 0, 0]), absmag);
    expect(far).toBeGreaterThan(near);
  });

  it('is brighter (smaller magnitude) at smaller distance', () => {
    const absmag = new Float32Array([4.83]);
    const at1 = computeAppMag(0, new Float32Array([1, 0, 0]), absmag);
    const at100 = computeAppMag(0, new Float32Array([100, 0, 0]), absmag);
    // At 1 pc the star appears 5 mag brighter than at 10 pc;
    // at 100 pc it appears 5 mag dimmer.
    expect(at1).toBeCloseTo(4.83 - 5, 4);
    expect(at100).toBeCloseTo(4.83 + 5, 4);
  });

  it('changes by 5 magnitudes per 10× distance change', () => {
    // Distance modulus formula: 5 mag per decade.
    const absmag = new Float32Array([0]);
    const m10 = computeAppMag(0, new Float32Array([10, 0, 0]), absmag);
    const m100 = computeAppMag(0, new Float32Array([100, 0, 0]), absmag);
    const m1000 = computeAppMag(0, new Float32Array([1000, 0, 0]), absmag);
    expect(m100 - m10).toBeCloseTo(5, 5);
    expect(m1000 - m100).toBeCloseTo(5, 5);
  });

  it('returns absmag (no modulus) when distance is zero', () => {
    // Sol-on-Sol or origin-on-origin: log(0) is undefined, so the
    // contract is to skip the modulus and return absmag directly.
    const positions = new Float32Array([0, 0, 0]);
    const absmag = new Float32Array([4.83]);
    expect(computeAppMag(0, positions, absmag)).toBeCloseTo(4.83, 5);
  });

  it('is monotonic non-decreasing in radial distance', () => {
    const absmag = new Float32Array([0]);
    let prev = -Infinity;
    for (const d of [0.1, 1, 5, 10, 50, 100, 500, 1000, 10000]) {
      const m = computeAppMag(0, new Float32Array([d, 0, 0]), absmag);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('uses 3D radial distance, not just one axis', () => {
    const absmag = new Float32Array([0]);
    // Same total radius via different axes — expect the same magnitude.
    const along = computeAppMag(0, new Float32Array([10, 0, 0]), absmag);
    const diag = computeAppMag(0, new Float32Array([6, 8, 0]), absmag); // hypot=10
    const xyz = computeAppMag(0, new Float32Array([2, 6, 7.745966]), absmag); // hypot≈10
    expect(along).toBeCloseTo(diag, 4);
    expect(along).toBeCloseTo(xyz, 4);
  });
});

describe('chart-labels / collides', () => {
  function cand(opts: Partial<Candidate>): Candidate {
    return {
      kind: 'name',
      text: 'X',
      x: 0,
      y: 0,
      width: 50,
      height: 14,
      priority: 0,
      key: 'k',
      ...opts,
    };
  }

  it('returns false against an empty list', () => {
    expect(collides(cand({}), [], 0)).toBe(false);
  });

  it('detects overlap of two start-anchored labels', () => {
    const a = cand({ x: 100, y: 100, width: 40 });
    const b = cand({ x: 120, y: 100, width: 40, key: 'b' }); // overlaps a in x
    expect(collides(a, [b], 1)).toBe(true);
  });

  it('returns false for non-overlapping labels with horizontal gap', () => {
    const a = cand({ x: 100, y: 100, width: 40 });
    const b = cand({ x: 200, y: 100, width: 40, key: 'b' });
    expect(collides(a, [b], 1)).toBe(false);
  });

  it('returns false for non-overlapping labels with vertical gap', () => {
    const a = cand({ x: 100, y: 100, width: 40 });
    const b = cand({ x: 100, y: 200, width: 40, key: 'b' });
    expect(collides(a, [b], 1)).toBe(false);
  });

  it('is symmetric for same-kind labels', () => {
    // Collision detection must be symmetric: A collides with B iff B
    // collides with A, when both share the same anchor convention.
    const a = cand({ x: 100, y: 100, width: 50 });
    const b = cand({ x: 130, y: 100, width: 50, key: 'b' });
    expect(collides(a, [b], 1)).toBe(collides(b, [a], 1));
  });

  it('honours middle-anchor for kind=con (centred AABB)', () => {
    // Constellation labels are centre-anchored, so a 50-wide label at
    // x=100 occupies [75, 125]. A start-anchored label at x=80 width=30
    // occupies [80, 110] — overlap.
    const con = cand({ kind: 'con', x: 100, y: 100, width: 50 });
    const name = cand({ kind: 'name', x: 80, y: 100, width: 30, key: 'b' });
    expect(collides(con, [name], 1)).toBe(true);
  });

  it('reports collision against any item in the list', () => {
    const a = cand({ x: 100, y: 100, width: 40 });
    const candidates = [
      cand({ x: 0, y: 0, width: 40, key: 'b' }),
      cand({ x: 1000, y: 1000, width: 40, key: 'c' }),
      cand({ x: 110, y: 100, width: 40, key: 'd' }), // collides with a
    ];
    expect(collides(a, candidates, candidates.length)).toBe(true);
  });

  it('ignores entries past the live count', () => {
    // `others` is the engine's pooled accepted array: everything from
    // `count` on is a previous, larger frame's leftovers and must not
    // block this frame's labels.
    const a = cand({ x: 100, y: 100, width: 40 });
    const stale = cand({ x: 110, y: 100, width: 40, key: 'stale' });
    expect(collides(a, [stale], 1)).toBe(true);
    expect(collides(a, [stale], 0)).toBe(false);
  });

  it('returns false when AABBs share only a single edge', () => {
    // Strict-less-than on the overlap test means edge-touching is not
    // a collision — two labels can sit flush next to each other.
    const a = cand({ x: 100, y: 100, width: 40 });
    const b = cand({ x: 140, y: 100, width: 40, key: 'b' }); // a ends at 140, b starts at 140
    expect(collides(a, [b], 1)).toBe(false);
  });
});

describe('chart-labels / measureCandidate', () => {
  it('produces a non-zero AABB for a non-empty label', () => {
    const c: Candidate = {
      kind: 'name', text: 'Sirius', x: 0, y: 0,
      width: 0, height: 0, priority: 0, key: 'k',
    };
    measureCandidate(c);
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  });

  it('makes constellation labels wider per character than start-anchored labels', () => {
    // Latin constellation names render in a heavier weight, so the per-
    // character width estimate is larger — the collision pad keeps these
    // out of the way of star labels.
    const star: Candidate = {
      kind: 'name', text: 'ABCDE', x: 0, y: 0,
      width: 0, height: 0, priority: 0, key: 'a',
    };
    const con: Candidate = {
      kind: 'con', text: 'ABCDE', x: 0, y: 0,
      width: 0, height: 0, priority: 0, key: 'b',
    };
    measureCandidate(star);
    measureCandidate(con);
    expect(con.width).toBeGreaterThan(star.width);
  });

  it('width scales linearly with text length', () => {
    const a: Candidate = {
      kind: 'name', text: 'ABC', x: 0, y: 0,
      width: 0, height: 0, priority: 0, key: 'a',
    };
    const b: Candidate = {
      kind: 'name', text: 'ABCABC', x: 0, y: 0,
      width: 0, height: 0, priority: 0, key: 'b',
    };
    measureCandidate(a);
    measureCandidate(b);
    // 6 chars of same kind should be wider than 3 chars by exactly
    // (6-3) × per-char-px (the collision padding is the same).
    const diff = b.width - a.width;
    expect(diff).toBeGreaterThan(0);
    // The per-char delta is consistent — no pad accumulation per char
    expect(diff).toBeCloseTo(diff, 1);
  });
});

describe('chart-labels / filterByDistAndSpect', () => {
  // Build small fixtures that exercise the boundary conditions —
  // distance bounds (inclusive both ends) and spectral bit mask.
  function makeFixture() {
    // 5 stars at distances 5, 10, 50, 100, 500 with spectral classes
    // 0, 1, 2, 3, 4 respectively. The spectClass is the index into the
    // bit-mask so a mask of 0b00001 keeps only spectClass=0.
    const distSol = new Float32Array([5, 10, 50, 100, 500]);
    const spectClass = new Uint8Array([0, 1, 2, 3, 4]);
    return { distSol, spectClass };
  }

  it('keeps everything when bounds are wide and mask is all-on', () => {
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 0, 1000, 0b11111,
    );
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects stars below the minimum distance', () => {
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 50, 1000, 0b11111,
    );
    // distSol < 50 → reject. Only indices with d >= 50.
    expect(out).toEqual([2, 3, 4]);
  });

  it('rejects stars above the maximum distance', () => {
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 0, 50, 0b11111,
    );
    expect(out).toEqual([0, 1, 2]);
  });

  it('treats distance bounds as inclusive at both ends', () => {
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 10, 100, 0b11111,
    );
    // 10 ≤ d ≤ 100 — indices 1, 2, 3 inclusive.
    expect(out).toEqual([1, 2, 3]);
  });

  it('rejects stars whose spectral bit is unset in the mask', () => {
    const { distSol, spectClass } = makeFixture();
    // Mask = bit 2 only → keeps spectClass===2 only.
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 0, 1000, 1 << 2,
    );
    expect(out).toEqual([2]);
  });

  it('combines distance and spectral filters with AND semantics', () => {
    const { distSol, spectClass } = makeFixture();
    // Distance window [10, 100] AND spectClass∈{1,3}
    const mask = (1 << 1) | (1 << 3);
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 10, 100, mask,
    );
    // Index 1: d=10 ✓, sc=1 ✓ → keep
    // Index 3: d=100 ✓, sc=3 ✓ → keep
    expect(out).toEqual([1, 3]);
  });

  it('returns an empty array when the mask is zero', () => {
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [0, 1, 2, 3, 4], distSol, spectClass, 0, 1000, 0,
    );
    expect(out).toEqual([]);
  });

  it('walks only the supplied indices', () => {
    // Caller pre-restricts to (e.g.) variable-star indices; the function
    // shouldn't surface stars outside that pre-filtered set even when
    // they'd otherwise pass the distance/spect gates.
    const { distSol, spectClass } = makeFixture();
    const out = filterByDistAndSpect(
      [1, 3], distSol, spectClass, 0, 1000, 0b11111,
    );
    expect(out).toEqual([1, 3]);
  });
});

describe('chart-labels / projectVecInto', () => {
  /** The helper writes into a caller-owned tuple and reports whether the
   *  point survived the near clip and the cull margin; these cases read
   *  more clearly as "the projection, or nothing". */
  const project = (
    p: THREE.Vector3,
    cam: THREE.PerspectiveCamera,
    w: number,
    h: number,
  ): [number, number] | null => {
    const out: [number, number] = [0, 0];
    return projectVecInto(p, cam, w, h, out) ? out : null;
  };

  function makeCamera() {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.updateProjectionMatrix();
    return cam;
  }

  it('returns null for a point at the near plane', () => {
    const cam = makeCamera();
    const p = new THREE.Vector3(0, 0, -0.005); // closer than near=0.01
    expect(project(p, cam, 800, 600)).toBeNull();
  });

  it('returns null for a point behind the camera', () => {
    const cam = makeCamera();
    const p = new THREE.Vector3(0, 0, 5);
    expect(project(p, cam, 800, 600)).toBeNull();
  });

  it('projects a centered point to the viewport centre', () => {
    const cam = makeCamera();
    const p = new THREE.Vector3(0, 0, -10);
    const xy = project(p, cam, 800, 600)!;
    expect(xy[0]).toBeCloseTo(400, 3);
    expect(xy[1]).toBeCloseTo(300, 3);
  });

  it('returns null for points well outside the viewport (cull margin)', () => {
    // The cull box is the viewport extended by ±200 horizontally and ±100
    // vertically, so a point projecting far past those bounds should be
    // dropped. Place it far enough off-axis to clearly exit even the
    // extended box.
    const cam = makeCamera();
    const p = new THREE.Vector3(1000, 0, -1);
    expect(project(p, cam, 800, 600)).toBeNull();
  });
});

describe('chart-labels / starLabelOffsetPx', () => {
  it('floors to the minimum offset for sub-pixel discs', () => {
    // Faint stars render at minPx = 1.5 px (radius 0.75 px); a tiny
    // disc-relative offset would crowd the label up against the dot.
    // The 9 px floor preserves readable breathing room.
    expect(starLabelOffsetPx(1.5)).toBe(9);
  });

  it('floors to the minimum offset for mid-size discs where radius + gap is still small', () => {
    // 9 px disc → radius 4.5 → 4.5 + 4 = 8.5 < 9, still floor.
    expect(starLabelOffsetPx(9)).toBe(9);
  });

  it('scales with disc radius for large discs', () => {
    // 28 px disc (the chart-mode max) → radius 14 → 14 + 4 = 18.
    expect(starLabelOffsetPx(28)).toBe(18);
  });

  it('is monotonic non-decreasing in disc size', () => {
    let prev = -Infinity;
    for (const d of [0, 1.5, 5, 9, 12, 16, 20, 28, 40]) {
      const off = starLabelOffsetPx(d);
      expect(off).toBeGreaterThanOrEqual(prev);
      prev = off;
    }
  });

  it("places the label's bottom-left corner outside the disc edge at max size", () => {
    // The label sits at (centre + (offset, -offset)) with text height
    // ~14 px and dominant-baseline=central. Its closest corner to the
    // star centre is roughly (offset, -offset + 7) — the bottom-left
    // of the start-anchored text box. That corner must lie outside the
    // disc of radius discPx/2 at the largest configured size.
    const discPx = 28;
    const off = starLabelOffsetPx(discPx);
    const cornerX = off;
    const cornerY = -off + 7; // text-height/2 below the y-anchor
    const cornerDist = Math.hypot(cornerX, cornerY);
    expect(cornerDist).toBeGreaterThan(discPx / 2);
  });

  it('keeps the tightest corner-clearance margin pinned at the floor/formula crossover', () => {
    // Max-size clearance above has ~7 px of margin — comfortable. The
    // tightest clearance the formula admits is where the
    // STAR_LABEL_OFFSET_MIN_PX floor (9) meets discPx/2 + STAR_LABEL_GAP_PX
    // (4): discPx/2 + 4 = 9 → discPx = 10. Pinned exactly so a future
    // MIN_PX/GAP_PX tweak can't silently shrink this margin.
    const FLOOR_FORMULA_CROSSOVER_PX = 10;
    const off = starLabelOffsetPx(FLOOR_FORMULA_CROSSOVER_PX);
    expect(off).toBe(9);
    const cornerX = off;
    const cornerY = -off + 7; // text-height/2 below the y-anchor
    const cornerDist = Math.hypot(cornerX, cornerY);
    expect(cornerDist).toBeCloseTo(9.219544457292887, 12);
    expect(cornerDist - FLOOR_FORMULA_CROSSOVER_PX / 2).toBeCloseTo(4.219544457292887, 12);
  });
});

// SVG has no z-index — paint order is document order, and `layerById`
// refuses to mint a group, so the markup below IS the fix. Grouping alone
// proves nothing: swap two <g> lines in index.html and the con wash eats
// the star-name halos again, or the chart paints over the HUD, with every
// other test still green.
describe('chart-labels / index.html paint order', () => {
  const markup = readFileSync(
    fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8',
  );
  const positionOf = (id: string): number => {
    const at = markup.indexOf(`id="${id}"`);
    expect(at, `#${id} is declared in index.html`).toBeGreaterThan(-1);
    expect(markup.indexOf(`id="${id}"`, at + 1), `#${id} is declared once`).toBe(-1);
    return at;
  };

  it('declares the chart groups in CHART_LAYER_IDS order', () => {
    const at = CHART_LAYER_IDS.map(positionOf);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('puts every chart group under the HUD stack', () => {
    // #hud-ring opens the HUD stack; everything after it is HUD chrome.
    const hud = positionOf('hud-ring');
    for (const id of CHART_LAYER_IDS) expect(positionOf(id)).toBeLessThan(hud);
  });
});

describe('chart-labels / ChartLabels lifecycle', () => {
  // Minimal SVG-group stand-in: chart-labels only ever touches style,
  // appendChild, and the firstChild / removeChild drain loop.
  interface StubNode {
    parent?: { removeChild: (c: unknown) => void };
  }

  function makeGroup() {
    const children: unknown[] = [];
    const group = {
      children,
      style: {} as Record<string, string>,
      setAttribute: () => {},
      appendChild: (c: unknown) => {
        (c as StubNode).parent = group;
        children.push(c);
      },
      removeChild: (c: unknown) => { children.splice(children.indexOf(c), 1); },
      // Mirrors ChildNode.remove — the engine detaches a dropped label through
      // the node itself, so the stub carries its own parent link.
      remove() { (group as StubNode).parent?.removeChild(group); },
      get firstChild() { return children.length > 0 ? children[0] : null; },
    };
    return group;
  }

  interface Harness {
    stellata: Stellata;
    ctx: ChartModeContext;
    emit: (name: 'frame' | 'filter') => void;
    handlerCount: () => number;
    ticks: () => number;
    positionsReads: () => number;
    memberWalks: () => number;
  }

  interface HarnessPatch {
    /** One star per entry, at `[0, 0, -distPc]` so it projects to screen
     *  centre. `con` is the byte-34 index the membership walk buckets by. */
    stars?: { con: number; absmag: number; distPc: number }[];
    names?: Map<number, string>;
    constellations?: { code: string; name: string }[];
    anchors?: { code: string; name: string; conIndex: number; position: THREE.Vector3 }[];
    detailPermits?: (id: string) => boolean;
  }

  function makeHarness(patch: HarnessPatch = {}): Harness {
    const handlers = new Map<string, Set<() => void>>();
    let ticks = 0;
    let positionsReads = 0;
    let absmagReads = 0;
    const stars = patch.stars ?? [];
    const positions = new Float32Array(stars.flatMap((s) => [0, 0, -s.distPc]));
    const absmag = new Float32Array(stars.map((s) => s.absmag));
    const catalog = {
      count: stars.length,
      names: patch.names ?? new Map<number, string>(),
      constellations: patch.constellations ?? ([] as unknown[]),
      constellation: new Uint8Array(stars.map((s) => s.con)),
      // With no star names, no Bayer glyphs and no variables, the only readers
      // are the glyph pass — once per tick, unconditionally — and the member
      // walk, once per member star. So the per-frame delta is 1 with the walk
      // skipped and 1 + one-per-star with it running.
      get absmag() { absmagReads++; return absmag; },
      spectClass: new Uint8Array(stars.length),
      periodDays: new Float32Array(stars.length),
      amplitudeMag: new Float32Array(stars.length),
      varType: new Uint8Array(stars.length),
      flags: new Uint8Array(stars.length),
      get positions() { positionsReads++; return positions; },
    };
    const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.01, 1000);
    camera.updateMatrixWorld(true);
    const stellata = {
      catalog,
      camera,
      localPositions: positions,
      // Read exactly once per tick (the full-tick skip key), so it doubles
      // as the tick counter.
      get advancedEpochJyr() { ticks++; return 2016; },
      uniforms: {
        uChartDiscMaxPx: { value: 28 },
        uChartDiscMinPx: { value: 1.5 },
        uChartMagBright: { value: -2 },
      },
      getT: () => 0,
      getWorldOffset: () => new THREE.Vector3(),
      constellationLabelAnchors: patch.anchors ?? [],
      filters: {
        getFilter: () => ({
          instrument: 'unaided-eye', minDistSol: 0, maxDistSol: 1e9,
          spectMask: 0xff,
        }),
      },
      detailPermits: patch.detailPermits ?? (() => true),
      getCloudCatalog: () => null,
      kinds: { planet: { field: { liveInstanceCount: 0 } } },
      on: (name: string, fn: () => void) => {
        let set = handlers.get(name);
        if (!set) { set = new Set(); handlers.set(name, set); }
        set.add(fn);
        return () => { set!.delete(fn); };
      },
    } as unknown as Stellata;
    return {
      stellata,
      ctx: { bayerMap: new Map(), starLabels: new Map() },
      emit: (name) => { for (const fn of handlers.get(name) ?? []) fn(); },
      handlerCount: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
      ticks: () => ticks,
      positionsReads: () => positionsReads,
      memberWalks: () => absmagReads,
    };
  }

  const realDocument = globalThis.document;
  const realWindow = globalThis.window;

  // Only the groups index.html actually declares resolve; an unknown id
  // answers null the way the real document does. Auto-vivifying instead
  // would hide a group going missing from the markup, which is the single
  // failure `layerById` exists to make loud.
  function installDomStubs(ids: readonly string[] = CHART_LAYER_IDS) {
    const groups = new Map<string, ReturnType<typeof makeGroup>>();
    for (const id of ids) groups.set(id, makeGroup());
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => groups.get(id) ?? null,
      createElementNS: () => makeGroup(),
    };
    (globalThis as { window?: unknown }).window = { innerWidth: 800, innerHeight: 600 };
    return groups;
  }

  afterEach(() => {
    (globalThis as { document?: unknown }).document = realDocument;
    (globalThis as { window?: unknown }).window = realWindow;
  });

  it('start subscribes, stop unsubscribes, and both are idempotent', () => {
    installDomStubs();
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);
    expect(labels.running).toBe(false);
    expect(h.handlerCount()).toBe(0);

    labels.start(h.ctx);
    expect(labels.running).toBe(true);
    const subscribed = h.handlerCount();
    expect(subscribed).toBe(2); // 'frame' + 'filter'

    // A second start must not double-subscribe — the engine would then
    // tick twice per frame and double-count the filter version.
    labels.start(h.ctx);
    expect(h.handlerCount()).toBe(subscribed);

    labels.stop();
    expect(labels.running).toBe(false);
    expect(h.handlerCount()).toBe(0);
    labels.stop();
    expect(h.handlerCount()).toBe(0);
  });

  it('ticks on frame while running and not after stop', () => {
    installDomStubs();
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);

    labels.start(h.ctx);
    h.emit('frame');
    expect(h.ticks()).toBe(1);

    labels.stop();
    h.emit('frame');
    expect(h.ticks()).toBe(1);
  });

  it('hides every SVG layer and drains their pooled children on stop', () => {
    const groups = installDomStubs();
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);

    labels.start(h.ctx);
    const layers = CHART_LAYER_IDS.map((id) => groups.get(id)!);
    for (const g of layers) {
      expect(g.style.display).toBe('');
      // Stand in for pooled <text> / <circle> entries from a prior frame.
      g.appendChild({});
    }

    labels.stop();
    for (const g of layers) {
      expect(g.style.display).toBe('none');
      expect(g.children).toHaveLength(0);
    }
  });

  it.each(CHART_LAYER_IDS)('start throws when index.html is missing #%s', (missing) => {
    installDomStubs(CHART_LAYER_IDS.filter((id) => id !== missing));
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);

    expect(() => labels.start(h.ctx)).toThrow(missing);
    expect(labels.running).toBe(false);
  });

  it('stop keeps the catalog-derived caches; dispose drops them', () => {
    installDomStubs();
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);

    labels.start(h.ctx);
    const afterFirstStart = h.positionsReads();
    expect(afterFirstStart).toBeGreaterThan(0);

    // Chart re-entry reuses the distSol mirror + membership map — walking
    // the catalog again per toggle is the cost the cache exists to avoid.
    labels.stop();
    labels.start(h.ctx);
    expect(h.positionsReads()).toBe(afterFirstStart);

    // dispose is the teardown boundary: the next start rebuilds from the
    // catalog rather than inheriting a prior instance's arrays.
    labels.dispose();
    expect(labels.running).toBe(false);
    labels.start(h.ctx);
    expect(h.positionsReads()).toBeGreaterThan(afterFirstStart);
  });

  it('dispose from a running engine releases the subscriptions', () => {
    installDomStubs();
    const h = makeHarness();
    const labels = new ChartLabels(h.stellata);

    labels.start(h.ctx);
    labels.dispose();
    expect(h.handlerCount()).toBe(0);
    h.emit('frame');
    expect(h.ticks()).toBe(0);
  });

  // Constellation names come off the shipped region anchors, not off the member
  // stars — the stars only decide whether a name is drawn at all.
  describe('region label anchors', () => {
    const CONSTELLATIONS = [
      { code: 'Ser', name: 'Serpens' },
      { code: 'Ori', name: 'Orion' },
    ];
    const SERPENS = 0;
    const ORION = 1;
    // Screen centre for a camera at the origin looking down −z.
    const AHEAD = new THREE.Vector3(0, 0, -100);

    function anchorHarness(patch: HarnessPatch = {}) {
      return makeHarness({
        constellations: CONSTELLATIONS,
        stars: [
          { con: SERPENS, absmag: 1, distPc: 10 },
          { con: ORION, absmag: 20, distPc: 10 },
        ],
        anchors: [
          { code: 'SER1', name: 'Serpens', conIndex: SERPENS, position: AHEAD.clone() },
          { code: 'SER2', name: 'Serpens', conIndex: SERPENS, position: AHEAD.clone() },
          { code: 'ORI', name: 'Orion', conIndex: ORION, position: AHEAD.clone() },
        ],
        ...patch,
      });
    }

    function drawnLabels(group: { children: unknown[] }): string[] {
      return group.children
        .map((c) => (c as { textContent?: string }).textContent)
        .filter((t): t is string => typeof t === 'string')
        .sort();
    }

    // Serpens' two anchors share a display name, so the pool has to key on the
    // region code — keying on the name or the table index would collapse them
    // to one <text> and drop the Cauda label.
    it('draws one label per anchor, so Serpens is named twice', () => {
      const groups = installDomStubs();
      const h = anchorHarness();
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);
      h.emit('frame');

      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual(['SERPENS', 'SERPENS']);
      labels.dispose();
    });

    // SVG has no z-index — paint order is document order, and the pool appends
    // a <text> the first frame its key is seen. Sharing one group therefore let
    // a con label that left and re-entered the viewport land after the star
    // names it overlaps, and its translucent 36px wash ate their halo. Two
    // groups fix the rank statically; same-group labels never wash over each
    // other.
    it('puts constellation names in their own group, apart from star names', () => {
      const groups = installDomStubs();
      // Anchors well above screen centre so the con label's padded anchor
      // point can't collide with the star name — this test is about grouping.
      const above = new THREE.Vector3(0, 30, -100);
      const h = makeHarness({
        constellations: CONSTELLATIONS,
        stars: [
          { con: SERPENS, absmag: 1, distPc: 10 },
          { con: ORION, absmag: 20, distPc: 10 },
        ],
        names: new Map([[0, 'Unukalhai']]),
        anchors: [
          { code: 'SER1', name: 'Serpens', conIndex: SERPENS, position: above.clone() },
          { code: 'SER2', name: 'Serpens', conIndex: SERPENS, position: above.clone() },
        ],
      });
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);
      h.emit('frame');

      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual(['SERPENS', 'SERPENS']);
      expect(drawnLabels(groups.get('chart-labels')!)).toEqual(['Unukalhai']);
      labels.dispose();
    });

    // Serpens' one member drops under the instrument limit as well, so both its
    // anchors go unnamed together — the gate is per constellation, not per anchor.
    it('gates a region on its brightest member, both anchors together', () => {
      const groups = installDomStubs();
      const h = anchorHarness({
        stars: [
          { con: SERPENS, absmag: 20, distPc: 10 },
          { con: ORION, absmag: 20, distPc: 10 },
        ],
      });
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);
      h.emit('frame');

      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual([]);
      labels.dispose();
    });

    // The member walk is the largest single chart-mode CPU cost, so it must not
    // run when the declutter floor withholds the names.
    it('skips the member walk entirely when no name is drawn', () => {
      // Two member stars, so a frame that walks them costs the glyph pass'
      // single unconditional read plus two.
      const GLYPH_PASS_READ = 1;
      function readsForOneFrame(patch: HarnessPatch): number {
        installDomStubs();
        const h = anchorHarness(patch);
        const labels = new ChartLabels(h.stellata);
        labels.start(h.ctx);
        const before = h.memberWalks();
        h.emit('frame');
        const reads = h.memberWalks() - before;
        labels.dispose();
        return reads;
      }

      expect(readsForOneFrame({
        detailPermits: (id) => id !== 'chartConstellationNames',
      })).toBe(GLYPH_PASS_READ);
      expect(readsForOneFrame({})).toBe(GLYPH_PASS_READ + 2);
    });

    // The sentinels are stamped only where the walk runs. Stamping them on a
    // skipped walk leaves `minAppMag` at its Infinity seed while the cache
    // reads as fresh, so names coming back on within the 0.5 pc threshold —
    // and without a filter change to bump the version — draw nothing.
    it('recomputes after names come back on without a filter change', () => {
      const groups = installDomStubs();
      let namesOn = false;
      const h = anchorHarness({
        detailPermits: (id) => id !== 'chartConstellationNames' || namesOn,
      });
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual([]);

      // Well under BRIGHTEST_RECOMPUTE_DIST_SQ, so the walk's own distance
      // gate would skip — but enough to defeat the full-tick skip and get a
      // second real tick without touching the filter version.
      namesOn = true;
      h.stellata.camera.position.x += 0.01;
      h.stellata.camera.updateMatrixWorld(true);
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual(['SERPENS', 'SERPENS']);
      labels.dispose();
    });

    // The candidate array is pooled across frames, so a frame with fewer
    // surviving labels must not inherit the previous frame's entries. A
    // pool sorted or walked past its live count would rank the retained
    // constellation names (priority tier 0) ahead of the live star name
    // and redraw a label the engine no longer built this frame.
    it('drops a previous frame\'s candidates when this frame builds fewer', () => {
      const groups = installDomStubs();
      const above = new THREE.Vector3(0, 30, -100);
      let conNamesOn = true;
      const h = makeHarness({
        constellations: CONSTELLATIONS,
        stars: [
          { con: SERPENS, absmag: 1, distPc: 10 },
          { con: ORION, absmag: 1, distPc: 10 },
        ],
        names: new Map([[0, 'Unukalhai']]),
        anchors: [
          { code: 'SER1', name: 'Serpens', conIndex: SERPENS, position: above.clone() },
          { code: 'SER2', name: 'Serpens', conIndex: SERPENS, position: above.clone() },
          { code: 'ORI', name: 'Orion', conIndex: ORION, position: above.clone() },
        ],
        detailPermits: (id) => id !== 'chartConstellationNames' || conNamesOn,
      });
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-con-labels')!))
        .toEqual(['ORION', 'SERPENS', 'SERPENS']);
      expect(drawnLabels(groups.get('chart-labels')!)).toEqual(['Unukalhai']);

      // One candidate left this frame; the three constellation names are
      // gone. Nudge the camera so the full-tick skip doesn't short-circuit.
      conNamesOn = false;
      h.stellata.camera.position.x += 0.01;
      h.stellata.camera.updateMatrixWorld(true);
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual([]);
      expect(drawnLabels(groups.get('chart-labels')!)).toEqual(['Unukalhai']);
      labels.dispose();
    });

    // The other half of pooled-Candidate reuse: a recycled entry must not
    // inherit the previous occupant's measured box. Constellation labels skip
    // measureCandidate, so a con landing in a slot that held a measured star
    // name would collide against that name's width instead of its own bare
    // anchor point — and cons are accepted first, so the stale box then
    // evicts live star names. Pool slots shift down whenever an earlier
    // family shrinks, which is what the magnitude slider does.
    it('clears a recycled candidate\'s measured box before a con reuses the slot', () => {
      const groups = installDomStubs();
      // 60 chars: a stale half-width of ~199 px reaches well past Rigel's
      // label on the 800×600 test viewport, so the assertion is unambiguous.
      const LONG = 'A'.repeat(60);
      const names = new Map([[0, 'Rigel'], [1, LONG]]);
      let conNamesOn = false;
      const h = makeHarness({
        constellations: CONSTELLATIONS,
        // appMag 5 — inside the limit, and faint enough that the label offset
        // sits on its 9 px floor, so the boxes overlap vertically.
        stars: [
          { con: ORION, absmag: 5, distPc: 10 },
          { con: ORION, absmag: 5, distPc: 10 },
        ],
        names,
        anchors: [{ code: 'ORI', name: 'Orion', conIndex: ORION, position: AHEAD.clone() }],
        detailPermits: (id) => id !== 'chartConstellationNames' || conNamesOn,
      });
      const labels = new ChartLabels(h.stellata);
      labels.start(h.ctx);

      // Frame 1: both names claim a slot and both are measured; the long one
      // loses the collision to Rigel (every harness star projects to centre)
      // but leaves its 398 px width on pooled slot 1.
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-labels')!)).toEqual(['Rigel']);

      // Frame 2: one name left, so the con takes slot 1. 'filter' breaks the
      // full-tick skip without perturbing any projection.
      names.delete(1);
      conNamesOn = true;
      h.emit('filter');
      h.emit('frame');
      expect(drawnLabels(groups.get('chart-con-labels')!)).toEqual(['ORION']);
      expect(drawnLabels(groups.get('chart-labels')!)).toEqual(['Rigel']);
      labels.dispose();
    });
  });
});
