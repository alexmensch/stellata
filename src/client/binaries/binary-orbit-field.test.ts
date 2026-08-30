import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BinaryOrbitField } from './binary-orbit-field';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  FLAG_IS_INNER_OF_HIERARCHY,
  NO_PARENT,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';
import { AU_PC, J2000_JD } from '../util/astronomy-constants';
import { tToJdUt } from '../solar-system/time/time';
import { advancePositionsToEpoch, jdeToJulianEpochYear } from '../loaders/epoch-advance-pure';
import { SUB_PIXEL_THRESHOLD_PX } from './binary-tuning';
import {
  evaluateOrbitSkyAU,
  evaluateOrbitInPlaneAU,
  projectSkyToICRS,
  projectGalacticPlaneToICRS,
} from './binary-orbit-pure';
import { orbitMemberSlots, relationToElements } from './orbit-relation-cache';

/** Bake the secondary's catalog xyz at primary + projected R(sepPaEpoch)
 *  so the fixture is a realistic measured pair — its baked placement
 *  agrees with the Kepler solution at the stored epoch, i.e. baseDiffPc
 *  equals bakedDiff to within the float32 quantum. Mirrors
 *  buildOrbitRelationCaches' J2000 epoch fallback when sepPaEpochJd is
 *  non-finite. */
function bakeSecondaryFromElements(positions: Float32Array, rel: BinaryRelation): void {
  const pBase = rel.primaryIdx * 3;
  const sBase = rel.secondaryIdx * 3;
  const sys = { x: positions[pBase], y: positions[pBase + 1], z: positions[pBase + 2] };
  const el = relationToElements(rel);
  const epoch = Number.isFinite(rel.sepPaEpochJd) ? rel.sepPaEpochJd : J2000_JD;
  let d: { x: number; y: number; z: number };
  if ((rel.flags & FLAG_HAS_INCLINATION) !== 0) {
    const ref = evaluateOrbitSkyAU(el, epoch);
    d = projectSkyToICRS(sys, ref.northAU * AU_PC, ref.eastAU * AU_PC, ref.radialAU * AU_PC);
  } else {
    const ref = evaluateOrbitInPlaneAU(el, epoch);
    d = projectGalacticPlaneToICRS(ref.xAU * AU_PC, ref.yAU * AU_PC);
  }
  positions[sBase] = sys.x + d.x;
  positions[sBase + 1] = sys.y + d.y;
  positions[sBase + 2] = sys.z + d.z;
}

// Catalog stand-in: 4 stars at various ICRS positions. The first two
// form a Tier 1 outer pair; the last two are inactive controls.
function makeFixture(): {
  binaries: BinariesData;
  absolutePositions: Float32Array;
  basePositions: Float32Array;
  velocities: Float32Array;
  absoluteMags: Float32Array;
  localPositions: Float32Array;
  compositeSuppress: Float32Array;
  iPositionAttr: THREE.InstancedBufferAttribute;
  iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
} {
  const positions = new Float32Array([
    2.0, 0.0, 0.0,   // 0: primary at 2 pc on +X (close enough to render)
    2.0, 0.0, 0.0,   // 1: inner secondary (collocated — synth promotion)
    0.0, 0.0, 0.0,   // 2: outer secondary — baked from the elements below
    50.0, 0.0, 0.0,  // 3: far star (control)
  ]);
  const mags = new Float32Array([2.0, 5.0, 4.0, 6.0]);

  const outer: BinaryRelation = {
    primaryIdx: 0,
    secondaryIdx: 2,
    flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
    parentRelation: NO_PARENT,
    pDays: 365.25 * 100,
    tJd: J2000_JD,
    e: 0.2,
    aAU: 10.0,
    iRad: 0.5,
    omegaRad: 0.3,
    OmegaRad: 0.4,
    q: 0.4,
    sepArcsec: 5.0,
    paDeg: 90.0,
    sepPaEpochJd: J2000_JD,
  };
  // Inner pair semi-major puffed to 1 AU (not Algol-realistic — that
  // would be ~0.05 AU) so it clears the sub-pixel LOD in the close-up
  // camera positions the tests below use, exercising the hierarchical
  // walk under both perturbations.
  const inner: BinaryRelation = {
    primaryIdx: 0,
    secondaryIdx: 1,
    flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION | FLAG_IS_INNER_OF_HIERARCHY,
    parentRelation: 0,
    pDays: 2.87,
    tJd: J2000_JD,
    e: 0.0,
    aAU: 1.0,
    iRad: 1.4,
    omegaRad: 0.0,
    OmegaRad: 0.0,
    q: 0.5,
    sepArcsec: 0.001,
    paDeg: 0.0,
    sepPaEpochJd: J2000_JD,
  };
  // Outer secondary baked at primary + R(epoch) — a realistic measured
  // pair. The inner pair stays collocated (Algol-style synth promotion).
  bakeSecondaryFromElements(positions, outer);
  const local = new Float32Array(positions);
  const suppress = new Float32Array(4);
  const binaries: BinariesData = {
    version: 1,
    relations: [outer, inner],
    primaryIdxToRelations: new Map([[0, [0, 1]]]),
    secondaryIdxToRelations: new Map([[1, [1]], [2, [0]]]),
  };

  // Three.js attributes need only be carriers for the field's
  // needsUpdate flag — no GPU bound in vitest.
  const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
  const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);

  return {
    binaries,
    absolutePositions: positions,
    // Tests carry zero space motion, so the epoch-advanced baseline equals
    // the absolute — off-focal-chain resets reduce to `base − worldOffset`,
    // matching the pre-fix `abs − worldOffset` the assertions below expect.
    basePositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    absoluteMags: mags,
    localPositions: local,
    compositeSuppress: suppress,
    iPositionAttr,
    iCompositeSuppressAttr,
  };
}

describe('BinaryOrbitField construction', () => {
  it('caches one entry per has_orbit relation, in topological order', () => {
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    expect(field.cachedRelations).toHaveLength(2);
    expect(field.cachedRelations[0].relationIdx).toBe(0);
    expect(field.cachedRelations[1].relationIdx).toBe(1);
    expect(field.cachedRelations[0].tier).toBe(1);
    expect(field.cachedRelations[1].tier).toBe(1);
  });

  it('member slots are ascending and deduplicated, and exclude non-members', () => {
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    // Star 0 is the primary of both relations; star 3 is in neither.
    expect(Array.from(orbitMemberSlots(field.cachedRelations, fx.binaries)))
      .toEqual([0, 1, 2]);
  });

  it.each(['q', 'aAU', 'e', 'pDays', 'tJd', 'omegaRad'] as const)(
    'skips has_orbit relations with NaN %s — stale binaries.bin defence',
    (field) => {
      const fx = makeFixture();
      // Construct a record that violates the binaries.bin invariant:
      // has_orbit=1 with NaN in a required Kepler element. Without the
      // buildCache guard, evaluateDelta would yield NaN ΔR each frame
      // and update() would write NaN into localPositions[primaryIdx],
      // poisoning every downstream consumer (chart-mode constellation
      // centroids, focus ring, …).
      fx.binaries.relations[0][field] = Number.NaN;
      const f = new BinaryOrbitField(fx);
      expect(f.cachedRelations).toHaveLength(1);
      expect(f.cachedRelations[0].relationIdx).toBe(1);

      // Confirm the protection holds at the per-frame seam too: a full
      // update() over the poisoned relation must leave localPositions
      // finite at the primary's slot.
      f.update(
        0, new THREE.Vector3(0, 0, 0), 10, 1000, Math.PI / 4,
      );
      const base = fx.binaries.relations[0].primaryIdx * 3;
      expect(Number.isFinite(fx.localPositions[base + 0])).toBe(true);
      expect(Number.isFinite(fx.localPositions[base + 1])).toBe(true);
      expect(Number.isFinite(fx.localPositions[base + 2])).toBe(true);
    },
  );
});

describe('BinaryOrbitField.update — visibility filters', () => {
  let fx: ReturnType<typeof makeFixture>;
  let field: BinaryOrbitField;
  beforeEach(() => {
    fx = makeFixture();
    field = new BinaryOrbitField(fx);
  });

  it('camera past VISIBILITY_HORIZON_PC: zero active relations, positions unchanged', () => {
    const camera = new THREE.Vector3(0, 0, 1e6);
    const t = (J2000_JD - 2440587.5) * 86400 + 365.25 * 86400; // +1 yr
    const active = field.update(t, camera, 15, 1080, 0.8);
    expect(active).toBe(0);
    // Positions stay at J2000-minus-worldOffset (= absolute, since
    // worldOffset is zero).
    for (let i = 0; i < fx.localPositions.length; i++) {
      expect(fx.localPositions[i]).toBe(fx.absolutePositions[i]);
    }
  });

  it('primary too faint at slider cutoff: relation skipped', () => {
    // Drop slider below the primary's effective apparent mag so the
    // visibility kill engages.
    const camera = new THREE.Vector3(0, 0, 0);
    const t = (J2000_JD - 2440587.5) * 86400 + 365.25 * 86400;
    const active = field.update(t, camera, -10, 1080, 0.8);
    expect(active).toBe(0);
    for (let i = 0; i < fx.localPositions.length; i++) {
      expect(fx.localPositions[i]).toBe(fx.absolutePositions[i]);
    }
  });
});

describe('BinaryOrbitField.update — Tier 1 perturbation', () => {
  // Camera parked just outside the primary so the angular separation
  // clears SUB_PIXEL_THRESHOLD_PX and the LOD lets Kepler run.
  const closeCamera = new THREE.Vector3(1.999, 0, 0);
  let fx: ReturnType<typeof makeFixture>;
  let field: BinaryOrbitField;
  beforeEach(() => {
    fx = makeFixture();
    field = new BinaryOrbitField(fx);
  });

  // Reading pair geometry back out of localPositions carries the
  // float32 grid quantum (~1.2e-7 pc per axis at the fixture's 2 pc) —
  // fine for asserting AU-scale orbit shape, so the sweeps below use a
  // 0.05 AU tolerance. Production consumers needing better re-evaluate
  // in float64 (see eclipse/README.md).
  const F32_TOL_AU = 0.05;

  // Rendered relative offset (secondary − primary) is the contract now:
  // baseDiffPc + ΔR(t) = R(t). Reading it as a slot difference cancels
  // any parent perturbation the shared primary carries.
  const relOffset = (fx: ReturnType<typeof makeFixture>, sIdx: number, pIdx: number) => [
    fx.localPositions[sIdx * 3 + 0] - fx.localPositions[pIdx * 3 + 0],
    fx.localPositions[sIdx * 3 + 1] - fx.localPositions[pIdx * 3 + 1],
    fx.localPositions[sIdx * 3 + 2] - fx.localPositions[pIdx * 3 + 2],
  ];
  // float32 readback quantum at the fixture's ~2 pc slots.
  const REL_TOL_PC = 1e-6;

  it('t = J2000: outer relative offset = R(epoch) = baseDiffPc; collocated inner renders at R(t)', () => {
    const tJ2000Unix = (J2000_JD - 2440587.5) * 86400;
    field.update(tJ2000Unix, closeCamera, 15, 1080, 0.8);
    // Control (star 3, in no relation) stays exactly at baseline.
    for (let c = 0; c < 3; c++) {
      expect(fx.localPositions[9 + c]).toBeCloseTo(fx.absolutePositions[9 + c], 10);
    }
    // Outer pair: ΔR = 0 at the stored epoch (J2000), so the rendered
    // relative offset equals baseDiffPc = R(J2000) exactly — the
    // elements-alone baseline, independent of the baked placement.
    const bd = field.cachedRelations[0].baseDiffPc;
    const rel = relOffset(fx, 2, 0);
    expect(Math.abs(rel[0] - bd.x)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rel[1] - bd.y)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rel[2] - bd.z)).toBeLessThan(REL_TOL_PC);
    // Collocated inner pair renders the full R(J2000), magnitude a (e=0).
    const off = Math.hypot(...relOffset(fx, 1, 0)) / AU_PC;
    expect(Math.abs(off - 1.0)).toBeLessThan(F32_TOL_AU);
  });

  it('|rendered relative offset| stays within [a(1−e), a(1+e)] over a period sweep (no displaced centre)', () => {
    // The displaced-centre defect: rendering a Kepler ellipse offset by
    // (bakedDiff − R(epoch)) swept the companion THROUGH the primary once
    // per period and past apoapsis on the far side (Alsephina Ab at
    // 0.562 AU > apoapsis 0.52 AU). The elements-alone offset R(t) is
    // bounded by the orbit itself at every phase — checked here on the
    // collocated inner pair (bakedDiff = 0, the sharpest case).
    const inner = fx.binaries.relations[1];
    const aAU = inner.aAU;
    const periodS = inner.pDays * 86400;
    const t0 = (J2000_JD - 2440587.5) * 86400;
    for (let k = 0; k < 16; k++) {
      field.update(t0 + (k / 16) * periodS, closeCamera, 15, 1080, 0.8);
      const off = Math.hypot(...relOffset(fx, 1, 0)) / AU_PC;
      expect(off).toBeGreaterThan(aAU * (1 - inner.e) - F32_TOL_AU);
      expect(off).toBeLessThan(aAU * (1 + inner.e) + F32_TOL_AU);
    }
  });

  it('t = J2000 + ¼ period: outer relative offset moves off baseDiffPc by an orbital ΔR', () => {
    const tQuarter = (J2000_JD - 2440587.5) * 86400 + 0.25 * 365.25 * 100 * 86400;
    field.update(tQuarter, closeCamera, 15, 1080, 0.8);
    const bd = field.cachedRelations[0].baseDiffPc;
    const rel = relOffset(fx, 2, 0);
    const dR = Math.hypot(rel[0] - bd.x, rel[1] - bd.y, rel[2] - bd.z);
    // Outer a=10 AU, ¼ of a 100-yr orbit ⇒ ΔR is several AU (4.8e-6 pc/AU).
    expect(dR).toBeGreaterThan(1e-6);
    expect(dR).toBeLessThan(1e-3);
  });

  it('one full outer period later, relative offset returns to baseDiffPc (ΔR → 0)', () => {
    // Isolate the outer pair: after one outer period ΔR_outer → 0, but the
    // shared primary keeps wobbling from the inner pair (2.87 d period,
    // off-phase at +100 yr), which would leak ~q_inner·a_inner into the
    // outer relative offset read from the shared slot.
    fx.binaries.relations[1].flags &= ~FLAG_HAS_ORBIT;
    const solo = new BinaryOrbitField(fx);
    const tNext = (J2000_JD - 2440587.5) * 86400 + 365.25 * 100 * 86400;
    solo.update(tNext, closeCamera, 15, 1080, 0.8);
    const bd = solo.cachedRelations[0].baseDiffPc;
    const rel = relOffset(fx, 2, 0);
    expect(Math.abs(rel[0] - bd.x)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rel[1] - bd.y)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rel[2] - bd.z)).toBeLessThan(REL_TOL_PC);
  });

  it('flushes version on the dynamic position attribute', () => {
    // three.js InstancedBufferAttribute's `needsUpdate` is write-only —
    // the getter always returns false. The per-call increment is on
    // `.version` instead; pin against it.
    const startV = fx.iPositionAttr.version;
    const startS = fx.iCompositeSuppressAttr.version;
    const t = (J2000_JD - 2440587.5) * 86400 + 365.25 * 86400;
    field.update(t, closeCamera, 15, 1080, 0.8);
    expect(fx.iPositionAttr.version).toBe(startV + 1);
    expect(fx.iCompositeSuppressAttr.version).toBe(startS + 1);
  });
});

describe('BinaryOrbitField.update — sub-pixel suppress', () => {
  it('sets iCompositeSuppress[secondaryIdx]=1 and skips Kepler when peakSep < threshold', () => {
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    // Camera position chosen so the outer (a·(1+e)=12 AU at 2 pc primary
    // distance) projects below SUB_PIXEL_THRESHOLD_PX. dCam_pc large so
    // peakArcsec is small but the primary is still within the magnitude
    // and horizon cutoffs.
    // peakArcsec = 12 / dCam_pc, peakPx = peakArcsec · ARCSEC_TO_RAD · (viewportPx / fovYRad)
    // For peakPx < 1.5 with viewport=1080, fov=0.8: peakArcsec · 4.84e-6 · 1350 < 1.5
    //   ⇒ peakArcsec < 230 ⇒ dCam_pc > 12/230 ≈ 0.05 (trivially true).
    // Use a camera FAR from the primary to compress the angular sep
    // — at dCam=900 pc, peakArcsec ≈ 0.013, peakPx ≈ 0.09. Suppress active.
    const camera = new THREE.Vector3(0, 0, -900);
    const t = (J2000_JD - 2440587.5) * 86400 + 50 * 365.25 * 86400;
    const active = field.update(t, camera, 15, 1080, 0.8);
    // Both relations (outer + inner) share the same primary at 900 pc,
    // pass mag + horizon, and increment activeCount before the sub-pixel
    // suppress branch fires.
    expect(active).toBe(2);
    // The outer secondary (idx 2) is composite-suppressed.
    expect(fx.compositeSuppress[2]).toBe(1);
    // And its position stays at J2000-minus-worldOffset (= absolute since
    // worldOffset is 0).
    expect(fx.localPositions[6]).toBe(fx.absolutePositions[6]);
    expect(fx.localPositions[7]).toBe(fx.absolutePositions[7]);
    expect(fx.localPositions[8]).toBe(fx.absolutePositions[8]);
  });

  it('collapse of a MISMATCHED pair anchors on baseDiffPc, not the baked slot diff', () => {
    // Secondary baked ~60 AU off its elements-alone R(epoch) — the
    // displaced-centre population. When the pair goes sub-pixel the
    // collapse must place it at primary + baseDiffPc (the active walk's
    // anchor), so crossing the gate never steps it by corr = baseDiffPc −
    // bakedDiff. Anchoring on the baked slot diff (the pre-fix behaviour)
    // would reintroduce that corr-sized snap for exactly these pairs.
    const positions = new Float32Array([
      2.0, 0.0, 0.0,      // primary
      2.0, 3e-4, 1e-4,    // secondary baked far off — mismatched
    ]);
    const mags = new Float32Array([2.0, 6.0]);
    const local = new Float32Array(positions);
    const suppress = new Float32Array(2);
    const rel: BinaryRelation = {
      primaryIdx: 0, secondaryIdx: 1,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 365.25 * 100, tJd: J2000_JD, e: 0.2, aAU: 10.0,
      iRad: 0.5, omegaRad: 0.3, OmegaRad: 0.4, q: 0.4,
      sepArcsec: 5.0, paDeg: 90.0, sepPaEpochJd: J2000_JD,
    };
    const binaries: BinariesData = {
      version: 1,
      relations: [rel],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    const field = new BinaryOrbitField({
      binaries, absolutePositions: positions,
      basePositions: new Float32Array(positions),
      velocities: new Float32Array(positions.length),
      absoluteMags: mags,
      localPositions: local, compositeSuppress: suppress,
      iPositionAttr: new THREE.InstancedBufferAttribute(local, 3),
      iCompositeSuppressAttr: new THREE.InstancedBufferAttribute(suppress, 1),
    });
    const bd = field.cachedRelations[0].baseDiffPc;
    const bakedDiff = {
      x: positions[3] - positions[0],
      y: positions[4] - positions[1],
      z: positions[5] - positions[2],
    };
    // The fixture is genuinely mismatched: bakedDiff is far from baseDiffPc.
    expect(Math.hypot(bd.x - bakedDiff.x, bd.y - bakedDiff.y, bd.z - bakedDiff.z))
      .toBeGreaterThan(1e-5);

    const camera = new THREE.Vector3(0, 0, -900);
    const t = (J2000_JD - 2440587.5) * 86400 + 50 * 365.25 * 86400;
    field.update(t, camera, 15, 1080, 0.8);
    expect(suppress[1]).toBe(1);
    // Collapsed offset == baseDiffPc (active-walk anchor), NOT bakedDiff.
    const off = [local[3] - local[0], local[4] - local[1], local[5] - local[2]];
    const F32_TOL_PC = 5e-7;
    expect(Math.abs(off[0] - bd.x)).toBeLessThan(F32_TOL_PC);
    expect(Math.abs(off[1] - bd.y)).toBeLessThan(F32_TOL_PC);
    expect(Math.abs(off[2] - bd.z)).toBeLessThan(F32_TOL_PC);
    expect(Math.hypot(off[0] - bakedDiff.x, off[1] - bakedDiff.y, off[2] - bakedDiff.z))
      .toBeGreaterThan(1e-5);
  });

  it('exempts a relation on the focal star slot-chain — no step-jump on zoom-out', () => {
    // A relation on the focal's slot-chain skips the sub-pixel gate so the
    // focal-frame ride reads a continuous perturbation; hard-switching
    // Kepler off at the threshold would snap the focal to its baseline and
    // jolt the camera (Algol Ab jump at ~75 AU, Capella Ab at ~800 AU).
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    const camera = new THREE.Vector3(0, 0, -900);
    const t = (J2000_JD - 2440587.5) * 86400 + 50 * 365.25 * 86400;

    // Focused on the outer secondary (catalog idx 2): its relation keeps
    // evaluating Kepler — no composite suppress, primary carries −q·ΔR —
    // even though the pair is sub-pixel at this camera distance.
    field.update(t, camera, 15, 1080, 0.8, 2);
    expect(fx.compositeSuppress[2]).toBe(0);
    const jumpMag = Math.hypot(
      fx.localPositions[0] - fx.absolutePositions[0],
      fx.localPositions[1] - fx.absolutePositions[1],
      fx.localPositions[2] - fx.absolutePositions[2],
    );
    expect(jumpMag).toBeGreaterThan(0);

    // Unfocused at the same camera: the gate applies as before.
    field.update(t, camera, 15, 1080, 0.8, null);
    expect(fx.compositeSuppress[2]).toBe(1);
    expect(fx.localPositions[0]).toBe(fx.absolutePositions[0]);
  });
});

describe('BinaryOrbitField.update — hierarchical walk', () => {
  it('inner pair perturbs the outer primary slot ADDITIVELY on top of the outer perturbation', () => {
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    // Camera close enough that both outer (a=10 AU) and inner (a=1 AU)
    // clear the sub-pixel LOD.
    const camera = new THREE.Vector3(1.999, 0, 0);
    // Pick t so both outer (P=100yr) and inner (P=2.87d) are off-periapsis.
    const tAfter = (J2000_JD - 2440587.5) * 86400 + 25 * 365.25 * 86400;
    field.update(tAfter, camera, 15, 1080, 0.8);
    // Aa1's slot (catalog idx 0) is touched by BOTH outer and inner.
    // Pull the inner-only contribution out by running a second field
    // that DROPS the outer relation, then comparing.
    const fx2 = makeFixture();
    fx2.binaries.relations[0].flags &= ~FLAG_HAS_ORBIT;
    const field2 = new BinaryOrbitField(fx2);
    field2.update(tAfter, camera, 15, 1080, 0.8);
    const innerOnlyP = [
      fx2.localPositions[0] - fx2.absolutePositions[0],
      fx2.localPositions[1] - fx2.absolutePositions[1],
      fx2.localPositions[2] - fx2.absolutePositions[2],
    ];
    // The Aa1 slot in the full hierarchy = outer_perturb + inner_perturb.
    // Subtract inner-only to recover an estimate of outer-only.
    const fullP = [
      fx.localPositions[0] - fx.absolutePositions[0],
      fx.localPositions[1] - fx.absolutePositions[1],
      fx.localPositions[2] - fx.absolutePositions[2],
    ];
    const outerEstP = [
      fullP[0] - innerOnlyP[0],
      fullP[1] - innerOnlyP[1],
      fullP[2] - innerOnlyP[2],
    ];
    // The "outer_perturb-only" should be substantial (a=10 AU at q=0.4 ⇒
    // peak ~4 AU = 1.9e-5 pc).
    const outerMag = Math.hypot(...outerEstP);
    expect(outerMag).toBeGreaterThan(1e-7);
    expect(outerMag).toBeLessThan(1e-3);
    // Inner-only should be substantially smaller — inner a=1 AU vs outer
    // a=10 AU gives a ratio of ~1/10 on amplitude; q split tilts further
    // (inner q=0.5 ⇒ primary side ~0.5·a, outer q=0.4 ⇒ ~0.6·a).
    const innerMag = Math.hypot(...innerOnlyP);
    expect(innerMag).toBeLessThan(outerMag * 0.2);
  });
});

describe('BinaryOrbitField.update — hierarchical inner-pair physics', () => {
  // Algol-shaped fixture: outer pair (Aa↔Ab, P≈680d, a≈2.8 AU) plus
  // inner spectroscopic pair (Aa1↔Aa2, P≈2.87d, a≈0.06 AU) sharing the
  // primary slot. Aa1 (catalog idx 0) is the shared primary; Aa2
  // (catalog idx 1) is collocated with Aa1 (synth-promotion); Ab
  // (catalog idx 2) lives at the published sep+PA. The inner pair's
  // relative offset must come out as ΔR_inner regardless of the outer
  // pair's current phase — otherwise the parent's barycentric shift on
  // Aa leaks into the inner-pair displacement as a ~q_outer·a_outer
  // oscillation (~1.1 AU contamination on Algol's 0.06 AU inner orbit).
  function makeAlgolFixture() {
    const positions = new Float32Array([
      2.64, 0, 0,   // 0: Aa1 (shared inner+outer primary)
      2.64, 0, 0,   // 1: Aa2 (inner secondary, collocated)
      2.64, 1e-5, 0, // 2: Ab (outer secondary, slight offset)
    ]);
    const mags = new Float32Array([2.1, 6.0, 3.4]);
    const local = new Float32Array(positions);
    const suppress = new Float32Array(3);
    const outer: BinaryRelation = {
      primaryIdx: 0, secondaryIdx: 2,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 680.0, tJd: J2000_JD, e: 0.0, aAU: 2.8,
      iRad: 1.4, omegaRad: 0.5, OmegaRad: 0.0,
      q: 0.4,
      sepArcsec: 0.1, paDeg: 90.0, sepPaEpochJd: J2000_JD,
    };
    const inner: BinaryRelation = {
      primaryIdx: 0, secondaryIdx: 1,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION | FLAG_IS_INNER_OF_HIERARCHY,
      parentRelation: 0,
      pDays: 2.87, tJd: J2000_JD, e: 0.0, aAU: 0.06,
      iRad: 1.7, omegaRad: 0.0, OmegaRad: 0.0,
      q: 0.5,
      sepArcsec: 0.001, paDeg: 0.0, sepPaEpochJd: J2000_JD,
    };
    const binaries: BinariesData = {
      version: 1,
      relations: [outer, inner],
      primaryIdxToRelations: new Map([[0, [0, 1]]]),
      secondaryIdxToRelations: new Map([[1, [1]], [2, [0]]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    return {
      binaries,
      absolutePositions: positions,
      basePositions: new Float32Array(positions),
      velocities: new Float32Array(positions.length),
      absoluteMags: mags,
      localPositions: local,
      compositeSuppress: suppress,
      iPositionAttr,
      iCompositeSuppressAttr,
    };
  }

  // Inner pair's displacement envelope (e=0 ⇒ |R(t)−R(J2000)| ≤ 2·a).
  // 1 AU = 1/206265 pc.
  const INNER_DISPLACEMENT_PC = 2 * 0.06 * (1 / 206264.806);
  // Outer pair's primary-side perturbation envelope: q·2·a.
  // Pre-fix this leaked into the inner-pair displacement as the bug.
  const OUTER_PERTURB_PC = 0.4 * 2 * 2.8 * (1 / 206264.806);
  // Camera ~0.0001 pc (~20 AU) from the primary so the inner pair's
  // 0.06 AU envelope clears SUB_PIXEL_THRESHOLD_PX. At Algol's true
  // 28 pc distance the inner pair is too compact to render its orbit
  // anyway — peak ~2 mas — so a contrived close-camera is what
  // exercises the hierarchical walk.
  const closeCamera = new THREE.Vector3(2.6399, 0, 0);
  // Pick t so outer is at peak parent perturbation (¼ period off
  // periapsis for a circular orbit).
  const tQuarter = (J2000_JD - 2440587.5) * 86400 + (680 / 4) * 86400;

  it('inner-pair relative offset stays ~ΔR_inner regardless of outer phase (no focal)', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8);
    const innerSep = Math.hypot(
      fx.localPositions[3] - fx.localPositions[0],
      fx.localPositions[4] - fx.localPositions[1],
      fx.localPositions[5] - fx.localPositions[2],
    );
    // Tight bound: ≤ a·(1+e) plus a small float-residue margin. Must
    // stay well below the outer-trace magnitude (where the pre-fix bug
    // landed it).
    expect(innerSep).toBeLessThanOrEqual(INNER_DISPLACEMENT_PC * 1.05);
    expect(innerSep).toBeLessThan(OUTER_PERTURB_PC * 0.1);
  });

  it('inner pair gated (sub-pixel) while outer active: secondary stays glued to the primary, not detached by the parent perturbation', () => {
    // Camera ~0.001 pc from the primary: the inner 0.06 AU pair falls below
    // SUB_PIXEL_THRESHOLD_PX (peakPx ≈ 0.4) while the outer 2.8 AU pair
    // stays super-pixel (peakPx ≈ 18) and keeps animating. This is the
    // zoom-out regime where the old gate left the inner secondary at its
    // raw baseline, detaching it from Aa1 by the outer q·ΔR (~1-2 AU).
    const gatedCamera = new THREE.Vector3(2.639, 0, 0);
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, gatedCamera, 15, 1080, 0.8);

    // Inner secondary Kepler is skipped (composite-suppressed)...
    expect(fx.compositeSuppress[1]).toBe(1);
    // ...but the outer pair still animates: Aa1 (shared primary) carries the
    // outer perturbation, well above the inner envelope.
    const aa1Pert = Math.hypot(
      fx.localPositions[0] - fx.absolutePositions[0],
      fx.localPositions[1] - fx.absolutePositions[1],
      fx.localPositions[2] - fx.absolutePositions[2],
    );
    expect(aa1Pert).toBeGreaterThan(INNER_DISPLACEMENT_PC);

    // Aa2 rides WITH Aa1's parent perturbation, offset from it only by the
    // inner epoch separation baseDiffPc (the SAME anchor the active walk
    // uses — the gate drops only ΔR), NOT stranded at the catalog baseline
    // where it would sit OUTER_PERTURB_PC off the parent-perturbed primary.
    // The residual is baseDiffPc_inner (≤ a_inner, e=0) plus the ~3e-7 pc
    // float32 readback quantum at 2.64 pc — orders below OUTER_PERTURB_PC.
    const innerSep = Math.hypot(
      fx.localPositions[3] - fx.localPositions[0],
      fx.localPositions[4] - fx.localPositions[1],
      fx.localPositions[5] - fx.localPositions[2],
    );
    expect(innerSep).toBeLessThan(INNER_DISPLACEMENT_PC + 3e-7);
    expect(innerSep).toBeLessThan(OUTER_PERTURB_PC * 0.1);
  });

  it('focusing an inner member is a no-op on the buffer (no rebase — barycentric always)', () => {
    // The focal star no longer rebases: focus=Aa2, focus=Aa1, and unfocus
    // all write byte-identical positions. Focus→unfocus is a pure state
    // change; the camera rides the focal via focalPerturbationInto instead.
    const fxF = makeAlgolFixture();
    new BinaryOrbitField(fxF).update(tQuarter, closeCamera, 15, 1080, 0.8, 1);
    const fxN = makeAlgolFixture();
    new BinaryOrbitField(fxN).update(tQuarter, closeCamera, 15, 1080, 0.8, null);
    for (let i = 0; i < fxF.localPositions.length; i++) {
      expect(fxF.localPositions[i]).toBe(fxN.localPositions[i]);
    }
    // Inner-pair relative offset still stays ~ΔR_inner (parent barycentric
    // shift doesn't leak into the inner-pair displacement).
    const innerSep = Math.hypot(
      fxF.localPositions[3] - fxF.localPositions[0],
      fxF.localPositions[4] - fxF.localPositions[1],
      fxF.localPositions[5] - fxF.localPositions[2],
    );
    expect(innerSep).toBeLessThanOrEqual(INNER_DISPLACEMENT_PC * 1.05);
    expect(innerSep).toBeLessThan(OUTER_PERTURB_PC * 0.1);
  });

  it('focalPerturbationInto(Aa2) includes the outer −q·ΔR term via the parent chain', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8, 1);
    const pert = new THREE.Vector3();
    expect(field.focalPerturbationInto(1, tQuarter, pert)).toBe(true);
    // Equals the walk's written displacement within the float32 grid
    // quantum at the fixture's 2.64 pc (≈1.6e-7 pc/axis).
    const F32_TOL = 3e-7;
    expect(Math.abs(pert.x - (fx.localPositions[3] - fx.absolutePositions[3]))).toBeLessThan(F32_TOL);
    expect(Math.abs(pert.y - (fx.localPositions[4] - fx.absolutePositions[4]))).toBeLessThan(F32_TOL);
    expect(Math.abs(pert.z - (fx.localPositions[5] - fx.absolutePositions[5]))).toBeLessThan(F32_TOL);
    // Chain includes the outer relation: pert magnitude exceeds the
    // inner-only envelope, so Aa2 rides the outer barycentre too.
    expect(pert.length()).toBeGreaterThan(INNER_DISPLACEMENT_PC);
  });

  it('relationOffsetPcInto answers R(t) about the relation ANCHOR, not the slot difference', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    const r = new THREE.Vector3();
    // No walk has run, so there is no ΔR to hand out.
    expect(field.relationOffsetPcInto(0, r)).toBe(false);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8);
    // Both pairs are circular, so |R(t)| is the semi-major axis at any t.
    expect(field.relationOffsetPcInto(0, r)).toBe(true);
    expect(r.length()).toBeCloseTo(2.8 * AU_PC, 12);
    const outer = r.clone();
    expect(field.relationOffsetPcInto(1, r)).toBe(true);
    expect(r.length()).toBeCloseTo(0.06 * AU_PC, 12);
    expect(field.relationOffsetPcInto(2, r)).toBe(false);
    // Ab's slot minus Aa1's is NOT that offset: the inner pair split the
    // shared primary slot again AFTER the outer step placed Ab, so the
    // difference carries a q_inner·ΔR_inner the secondary never saw. Reading
    // the barycentre off both slots inherits it, which is what pushed the
    // drawn ring off Algol Ab.
    const slotDiff = new THREE.Vector3(
      fx.localPositions[6] - fx.localPositions[0],
      fx.localPositions[7] - fx.localPositions[1],
      fx.localPositions[8] - fx.localPositions[2],
    );
    // Bounded by q_inner·2a_inner, plus the float32 slot quantum at 2.64 pc.
    const F32_TOL = 3e-7;
    expect(slotDiff.sub(outer).length())
      .toBeLessThanOrEqual(0.5 * INNER_DISPLACEMENT_PC + F32_TOL);
  });

  it('focalPerturbationInto(Aa1) matches the shared-primary displacement', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8, 0);
    const pert = new THREE.Vector3();
    expect(field.focalPerturbationInto(0, tQuarter, pert)).toBe(true);
    const F32_TOL = 3e-7;
    expect(Math.abs(pert.x - (fx.localPositions[0] - fx.absolutePositions[0]))).toBeLessThan(F32_TOL);
    expect(Math.abs(pert.y - (fx.localPositions[1] - fx.absolutePositions[1]))).toBeLessThan(F32_TOL);
    expect(Math.abs(pert.z - (fx.localPositions[2] - fx.absolutePositions[2]))).toBeLessThan(F32_TOL);
  });
});

describe('BinaryOrbitField — stored-separation epoch baseline', () => {
  const EPOCH_JD = J2000_JD + 23 * 365.25; // ≈ 2023, a typical WDS date_last
  const closeCamera = new THREE.Vector3(1.999, 0, 0);
  const toUnix = (jd: number) => (jd - 2440587.5) * 86400;

  function epochFixture(flags: number) {
    const fx = makeFixture();
    // Drop the inner relation — its J2000-epoch perturbation would
    // otherwise mask the outer pair's baseline at t = EPOCH_JD.
    fx.binaries.relations[1].flags &= ~FLAG_HAS_ORBIT;
    fx.binaries.relations[0].flags = flags;
    fx.binaries.relations[0].sepPaEpochJd = EPOCH_JD;
    return fx;
  }

  const relOuter = (fx: ReturnType<typeof epochFixture>) => [
    fx.localPositions[6] - fx.localPositions[0],
    fx.localPositions[7] - fx.localPositions[1],
    fx.localPositions[8] - fx.localPositions[2],
  ];
  const REL_TOL_PC = 1e-6;

  it('Tier 1: relative offset = baseDiffPc at the stored epoch, ΔR ≠ 0 at J2000', () => {
    const fx = epochFixture(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);
    const field = new BinaryOrbitField(fx);
    const bd = field.cachedRelations[0].baseDiffPc;

    // At J2000 (≠ stored epoch) the pair has moved off the baseline: the
    // rendered offset R(J2000) differs from R(EPOCH_JD) = baseDiffPc.
    field.update(toUnix(J2000_JD), closeCamera, 15, 1080, 0.8);
    const rJ2000 = relOuter(fx);
    expect(Math.hypot(rJ2000[0] - bd.x, rJ2000[1] - bd.y, rJ2000[2] - bd.z))
      .toBeGreaterThan(1e-7);

    // At the stored epoch ΔR = 0, so the rendered offset is baseDiffPc.
    field.update(toUnix(EPOCH_JD), closeCamera, 15, 1080, 0.8);
    const rEpoch = relOuter(fx);
    expect(Math.abs(rEpoch[0] - bd.x)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[1] - bd.y)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[2] - bd.z)).toBeLessThan(REL_TOL_PC);
  });

  it('Tier 2: relative offset = baseDiffPc at the stored epoch', () => {
    const fx = epochFixture(FLAG_HAS_ORBIT);
    const field = new BinaryOrbitField(fx);
    const bd = field.cachedRelations[0].baseDiffPc;
    field.update(toUnix(EPOCH_JD), closeCamera, 15, 1080, 0.8);
    const rEpoch = relOuter(fx);
    expect(Math.abs(rEpoch[0] - bd.x)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[1] - bd.y)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[2] - bd.z)).toBeLessThan(REL_TOL_PC);
  });

  it('NaN sepPaEpochJd falls back to the J2000 baseline', () => {
    const fx = epochFixture(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);
    fx.binaries.relations[0].sepPaEpochJd = Number.NaN;
    const field = new BinaryOrbitField(fx);
    const bd = field.cachedRelations[0].baseDiffPc;
    // Baseline epoch falls back to J2000 → ΔR = 0 there → offset = baseDiffPc.
    field.update(toUnix(J2000_JD), closeCamera, 15, 1080, 0.8);
    const rEpoch = relOuter(fx);
    expect(Math.abs(rEpoch[0] - bd.x)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[1] - bd.y)).toBeLessThan(REL_TOL_PC);
    expect(Math.abs(rEpoch[2] - bd.z)).toBeLessThan(REL_TOL_PC);
  });
});

describe('BinaryOrbitField.recenter', () => {
  it('writes positions in the new local frame on next update', () => {
    const fx = makeFixture();
    const field = new BinaryOrbitField(fx);
    field.recenter(new THREE.Vector3(2, 0, 0));
    const camera = new THREE.Vector3(0, 0, 0);
    const t = (J2000_JD - 2440587.5) * 86400 + 50 * 365.25 * 86400;
    field.update(t, camera, 15, 1080, 0.8);
    // The primary (idx 0) catalog xyz is (2, 0, 0). After a recenter to
    // (2, 0, 0) its local-frame baseline is (0, 0, 0) plus the
    // perturbation. So localPositions[0] should be tiny.
    expect(Math.abs(fx.localPositions[0])).toBeLessThan(1);
    expect(Math.abs(fx.localPositions[1])).toBeLessThan(1);
    expect(Math.abs(fx.localPositions[2])).toBeLessThan(1);
  });
});

describe('SUB_PIXEL_THRESHOLD_PX shape', () => {
  it('exposes the tuning constant unchanged (used as a vitest pin)', () => {
    // Tests AND the runtime both read from binary-tuning.ts. This pin
    // catches accidental rename / re-export breakage.
    expect(SUB_PIXEL_THRESHOLD_PX).toBeGreaterThan(0);
    expect(SUB_PIXEL_THRESHOLD_PX).toBeLessThan(10);
  });
});

// Sirius B test — physical sanity check that the offset magnitude
// matches the published orbit. Sirius A is at ~2.64 pc; B's max
// separation is ~11 arcsec = ~30 AU = ~1.45e-4 pc.
describe('BinaryOrbitField — physical sanity (Sirius-shaped)', () => {
  it('produces a sub-mpc offset for Sirius-class binary over one period', () => {
    const positions = new Float32Array([2.64, 0, 0, 0, 0, 0]);
    const mags = new Float32Array([1.46, 8.44]);
    const suppress = new Float32Array(2);
    const r: BinaryRelation = {
      primaryIdx: 0,
      secondaryIdx: 1,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 50.13 * 365.25,
      tJd: J2000_JD - 10 * 365.25,
      e: 0.591,
      aAU: 19.77,
      iRad: 2.5,
      omegaRad: 0.7,
      OmegaRad: 0.8,
      q: 0.33,
      sepArcsec: 7.5,
      paDeg: 60,
      sepPaEpochJd: J2000_JD,
    };
    // Realistic bake: B sits at A + R(epoch), so its displacement from
    // baseline over a period is the pure orbital (1−q)·ΔR.
    bakeSecondaryFromElements(positions, r);
    const local = new Float32Array(positions);
    const binaries: BinariesData = {
      version: 1,
      relations: [r],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    const field = new BinaryOrbitField({
      binaries,
      absolutePositions: positions,
      basePositions: new Float32Array(positions),
      velocities: new Float32Array(positions.length),
      absoluteMags: mags,
      localPositions: local,
      compositeSuppress: suppress,
      iPositionAttr,
      iCompositeSuppressAttr,
    });
    let maxOffset = 0;
    // Camera at (2.63, 0, 0) → 0.01 pc from Sirius A; angular separation
    // peaks at ~3150 arcsec ⇒ well above SUB_PIXEL_THRESHOLD_PX.
    const camera = new THREE.Vector3(2.63, 0, 0);
    for (let k = 0; k < 32; k++) {
      const t = (J2000_JD - 2440587.5) * 86400 + (k / 32) * 50.13 * 365.25 * 86400;
      field.update(t, camera, 15, 1080, 0.8);
      const sOffset = Math.hypot(
        local[3] - positions[3],
        local[4] - positions[4],
        local[5] - positions[5],
      );
      if (sOffset > maxOffset) maxOffset = sOffset;
    }
    const expectedPeak = 19.77 * (1 + 0.591) * (1 - 0.33) * AU_PC;
    expect(maxOffset).toBeGreaterThan(expectedPeak * 0.4);
    expect(maxOffset).toBeLessThan(expectedPeak * 1.2);
  });
});

describe('BinaryOrbitField.update — no focal rebase (barycentric always)', () => {
  // The focal star no longer rebases to the local origin. The walk writes
  // the same barycentric split whether or not a pair member is focused, so
  // focus→unfocus is a no-op on positions; the camera tracks the focal via
  // focalPerturbationInto (the focal-frame ride in the integration shell).

  // One-relation fixture: avoids the makeFixture()'s nested inner pair
  // bleeding into the primary's slot and confusing the q-scaling ratio.
  function singleRelationFixture(qVal: number) {
    const positions = new Float32Array([
      2.0, 0.0, 0.0,
      1.5, 0.5, 0.0,
    ]);
    const mags = new Float32Array([2.0, 4.0]);
    const local = new Float32Array(positions);
    const suppress = new Float32Array(2);
    const relation: BinaryRelation = {
      primaryIdx: 0,
      secondaryIdx: 1,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 365.25 * 100,
      tJd: J2000_JD,
      e: 0.2,
      aAU: 10.0,
      iRad: 0.5,
      omegaRad: 0.3,
      OmegaRad: 0.4,
      q: qVal,
      sepArcsec: 5.0,
      paDeg: 90.0,
      sepPaEpochJd: J2000_JD,
    };
    const binaries: BinariesData = {
      version: 1,
      relations: [relation],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    return {
      binaries,
      absolutePositions: positions,
      basePositions: new Float32Array(positions),
      velocities: new Float32Array(positions.length),
      absoluteMags: mags,
      localPositions: local,
      compositeSuppress: suppress,
      iPositionAttr,
      iCompositeSuppressAttr,
    };
  }

  const closeCamera = new THREE.Vector3(1.999, 0, 0);
  const tNonZero = (J2000_JD - 2440587.5) * 86400 + 12 * 365.25 * 86400;
  // float32 grid quantum at the fixture's ~2 pc: |pos|·2⁻²³ ≈ 2.4e-7 pc.
  const F32_TOL_PC = 3e-7;

  it.each([0, 1, 99] as const)(
    'focal=%d writes a byte-identical buffer to unfocused (barycentric always)',
    (focal) => {
      const fxF = singleRelationFixture(0.4);
      new BinaryOrbitField(fxF).update(tNonZero, closeCamera, 15, 1080, 0.8, focal);
      const fxN = singleRelationFixture(0.4);
      new BinaryOrbitField(fxN).update(tNonZero, closeCamera, 15, 1080, 0.8, null);
      for (let i = 0; i < fxF.localPositions.length; i++) {
        expect(fxF.localPositions[i]).toBe(fxN.localPositions[i]);
      }
    },
  );

  it('focalPerturbationInto: primary = −q·ΔR, secondary = (1−q)·ΔR, each matching the walk', () => {
    const fx = singleRelationFixture(0.4);
    const field = new BinaryOrbitField(fx);
    field.update(tNonZero, closeCamera, 15, 1080, 0.8, 0);

    const pPert = new THREE.Vector3();
    const sPert = new THREE.Vector3();
    expect(field.focalPerturbationInto(0, tNonZero, pPert)).toBe(true);
    expect(field.focalPerturbationInto(1, tNonZero, sPert)).toBe(true);

    // Each matches the walk's written displacement within the float32 quantum.
    expect(Math.abs(pPert.x - (fx.localPositions[0] - fx.absolutePositions[0]))).toBeLessThan(F32_TOL_PC);
    expect(Math.abs(sPert.x - (fx.localPositions[3] - fx.absolutePositions[3]))).toBeLessThan(F32_TOL_PC);

    // Primary and secondary orbital motions are anti-parallel with
    // magnitude ratio q : (1−q). The secondary's total displacement also
    // carries the constant corr = baseDiffPc − bakedDiff (the elements-
    // alone anchor); subtract it to isolate the (1−q)·ΔR orbital term.
    // q=0.4 ⇒ |p|/|s_orbital| = 0.4/0.6 ≈ 0.667.
    const bd = field.cachedRelations[0].baseDiffPc;
    const corr = new THREE.Vector3(
      bd.x - (fx.absolutePositions[3] - fx.absolutePositions[0]),
      bd.y - (fx.absolutePositions[4] - fx.absolutePositions[1]),
      bd.z - (fx.absolutePositions[5] - fx.absolutePositions[2]),
    );
    const sOrbital = sPert.clone().sub(corr);
    expect(pPert.length() / sOrbital.length()).toBeCloseTo(0.4 / 0.6, 3);
    expect(pPert.clone().normalize().dot(sOrbital.clone().normalize())).toBeCloseTo(-1, 5);
  });

  it('focalPerturbationInto is continuous across consecutive sim times', () => {
    const fx = singleRelationFixture(0.4);
    const field = new BinaryOrbitField(fx);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    field.focalPerturbationInto(0, tNonZero, a);
    field.focalPerturbationInto(0, tNonZero + 3600, b); // +1 hour on a 100-yr orbit
    expect(b.distanceTo(a)).toBeLessThan(1e-8);
  });

  it('focalPerturbationInto returns false + zeroed out for a star in no relation', () => {
    const fx = singleRelationFixture(0.4);
    const field = new BinaryOrbitField(fx);
    const out = new THREE.Vector3(9, 9, 9);
    expect(field.focalPerturbationInto(99, tNonZero, out)).toBe(false);
    expect(out.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
  });
});

describe('BinaryOrbitField.update — epoch drift precision', () => {
  it('unfocused: a drifting system advances smoothly, not on the float32 abs grid', () => {
    // Primary ~18 pc out — where the float32 absolute ULP (~2.1e-6 pc ≈
    // 0.4 AU) dwarfs a tight binary orbit. Resetting the local slot from
    // `abs − origin` snaps the whole system onto that grid as it drifts
    // under scrub (the reported "all three stars teleport" bug); the
    // float64 `(base + v·Δt) − origin` reset keeps it continuous.
    const D = 18.0;
    const positions = new Float32Array([D, 0, 0, D, 0, 0]);
    const base = new Float32Array(positions);
    // ~0.85 AU/yr radial on both members (systemic space motion).
    const vRadial = 0.85 * AU_PC;
    const vel = new Float32Array([vRadial, 0, 0, vRadial, 0, 0]);
    const mags = new Float32Array([2.0, 5.0]);
    const local = new Float32Array(positions);
    const suppress = new Float32Array(2);
    // e=0, effectively static orbit (Myr period) so the primary slot's
    // frame-to-frame delta is dominated by the systemic drift under test.
    const rel: BinaryRelation = {
      primaryIdx: 0, secondaryIdx: 1,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 365.25e6, tJd: J2000_JD, e: 0.0, aAU: 1.0,
      iRad: 0.5, omegaRad: 0.0, OmegaRad: 0.0, q: 0.5,
      sepArcsec: 0.001, paDeg: 0.0, sepPaEpochJd: J2000_JD,
    };
    const binaries: BinariesData = {
      version: 1, relations: [rel],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    const field = new BinaryOrbitField({
      binaries, absolutePositions: positions,
      basePositions: base, velocities: vel,
      absoluteMags: mags, localPositions: local, compositeSuppress: suppress,
      iPositionAttr: new THREE.InstancedBufferAttribute(local, 3),
      iCompositeSuppressAttr: new THREE.InstancedBufferAttribute(suppress, 1),
    });
    field.recenter(new THREE.Vector3(D, 0, 0)); // origin on the primary
    const camera = new THREE.Vector3(1e-4, 0, 0); // ~20 AU: super-pixel, Kepler active

    let prevX: number | null = null;
    let firstX: number | null = null;
    let lastX = 0;
    let maxStepAu = 0;
    // Sweep 1.5 yr of epoch in fine steps (~0.005 yr): each true systemic
    // step is ~0.004 AU. Each frame also re-advances the float32 absolute
    // buffer exactly as `maybeReAdvanceEpoch` does at runtime — the abs-reset
    // path (focused/pre-fix) reads it and snaps in ~0.4 AU ULP jumps. Both
    // assertions discriminate the fix: smoothness fails on the snap, total
    // drift confirms the float64 reset tracks the systemic motion at all.
    for (let k = 0; k <= 300; k++) {
      const years = 10 + k * (1.5 / 300);
      const tSec = (J2000_JD - 2440587.5) * 86400 + years * 365.25 * 86400;
      advancePositionsToEpoch(base, vel, jdeToJulianEpochYear(tToJdUt(tSec)), positions);
      field.update(tSec, camera, 15, 1080, 0.8, null);
      const x = local[0];
      if (prevX !== null) maxStepAu = Math.max(maxStepAu, Math.abs(x - prevX) / AU_PC);
      if (firstX === null) firstX = x;
      lastX = x;
      prevX = x;
    }
    expect(maxStepAu).toBeLessThan(0.05);
    // The float64 reset tracks the full systemic drift (~1.27 AU over 1.5 yr);
    // the abs-reset path swallows sub-ULP motion and drifts ~0.
    expect(Math.abs(lastX - (firstX ?? 0)) / AU_PC).toBeGreaterThan(1.0);
  });
});

describe('BinaryOrbitField.update — static-frame skip', () => {
  const t0 = (J2000_JD - 2440587.5) * 86400;
  // At 2 pc with viewport 1080 / fov 0.8 the fixture's widest pair peaks
  // well below SUB_PIXEL_THRESHOLD_PX, so both relations suppress: zero
  // Kepler evals but non-zero active count — the shipping idle state.
  const idleCamera = new THREE.Vector3(0, 0, 0);
  let fx: ReturnType<typeof makeFixture>;
  let field: BinaryOrbitField;
  beforeEach(() => {
    fx = makeFixture();
    field = new BinaryOrbitField(fx);
  });

  const versions = () => [fx.iPositionAttr.version, fx.iCompositeSuppressAttr.version];

  // A walk that reproduces the previous frame's values uploads nothing, so
  // the attribute version can't report whether the walk ran. Corrupting a
  // slot the walk always rewrites can: restored means it ran.
  const walkRan = (call: (f: BinaryOrbitField) => void): boolean => {
    const CORRUPT = -999;
    fx.localPositions[2 * 3] = CORRUPT;
    call(field);
    return fx.localPositions[2 * 3] !== CORRUPT;
  };

  it('skips the walk + re-upload on identical inputs once zero Kepler evals settled', () => {
    const first = field.update(t0, idleCamera, 15, 1080, 0.8);
    expect(fx.compositeSuppress[1]).toBe(1);
    expect(fx.compositeSuppress[2]).toBe(1);
    const before = versions();
    const second = field.update(t0 + 3600, idleCamera, 15, 1080, 0.8);
    expect(second).toBe(first);
    expect(versions()).toEqual(before);
    expect(fx.compositeSuppress[1]).toBe(1);
    expect(fx.compositeSuppress[2]).toBe(1);
  });

  it('never skips while any relation is Kepler-active (focused orbit keeps animating)', () => {
    const closeCamera = new THREE.Vector3(1.999, 0, 0);
    field.update(t0, closeCamera, 15, 1080, 0.8);
    expect(walkRan((f) => f.update(t0 + 3600, closeCamera, 15, 1080, 0.8))).toBe(true);
  });

  it.each([
    ['camera moves', (f: BinaryOrbitField) =>
      f.update(t0, new THREE.Vector3(0.1, 0, 0), 15, 1080, 0.8)],
    ['threshold magnitude moves', (f: BinaryOrbitField) =>
      f.update(t0, idleCamera, 14, 1080, 0.8)],
    ['viewport changes', (f: BinaryOrbitField) =>
      f.update(t0, idleCamera, 15, 2160, 0.8)],
    ['fov changes', (f: BinaryOrbitField) =>
      f.update(t0, idleCamera, 15, 1080, 0.4)],
    ['focal changes', (f: BinaryOrbitField) =>
      f.update(t0, idleCamera, 15, 1080, 0.8, 0)],
  ] as const)('re-runs when %s', (_name, call) => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    expect(walkRan(call)).toBe(true);
  });

  it.each([
    ['markBaselinesDirty', (f: BinaryOrbitField) => f.markBaselinesDirty()],
    ['recenter', (f: BinaryOrbitField) => f.recenter(new THREE.Vector3(1, 0, 0))],
  ] as const)('%s forces the next update to walk again', (_name, poke) => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    poke(field);
    expect(walkRan((f) => f.update(t0, idleCamera, 15, 1080, 0.8))).toBe(true);
  });

  it('a walk reproducing the previous frame\'s buffers uploads nothing', () => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    const before = versions();
    // Camera motion alone: the walk re-runs (gates re-evaluate) but every
    // suppressed placement lands on the same float32 value as last frame.
    field.update(t0, new THREE.Vector3(0.1, 0, 0), 15, 1080, 0.8);
    field.update(t0, new THREE.Vector3(0.2, 0, 0), 15, 1080, 0.8);
    expect(versions()).toEqual(before);
    expect(fx.iPositionAttr.updateRanges).toHaveLength(0);
  });

  it('re-uploads a moved member as a bounded range, never the whole buffer', () => {
    const closeCamera = new THREE.Vector3(1.999, 0, 0);
    field.update(t0, closeCamera, 15, 1080, 0.8);
    // Stand in for the renderer's upload, which consumes both attributes.
    fx.iPositionAttr.clearUpdateRanges();
    fx.iCompositeSuppressAttr.clearUpdateRanges();
    // A day advances the P = 2.87 d inner pair by a third of its orbit.
    field.update(t0 + 86400, closeCamera, 15, 1080, 0.8);
    const ranges = fx.iPositionAttr.updateRanges;
    expect(ranges).toHaveLength(1);
    // Slots 0-2 are the pair members; the control star at slot 3 is not in
    // the tracked set, so no range can reach its elements 9-11.
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].start + ranges[0].count).toBeLessThanOrEqual(9);
    // Gate verdicts are unchanged, so the suppress buffer stays put.
    expect(fx.iCompositeSuppressAttr.updateRanges).toHaveLength(0);
  });

  it.each([
    ['markBaselinesDirty', (f: BinaryOrbitField) => f.markBaselinesDirty()],
    ['recenter', (f: BinaryOrbitField) => f.recenter(new THREE.Vector3(1, 0, 0))],
  ] as const)('%s uploads in full — a wholesale rewrite reaches untracked stars', (_name, poke) => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    fx.iPositionAttr.clearUpdateRanges();
    const version = fx.iPositionAttr.version;
    poke(field);
    field.update(t0, idleCamera, 15, 1080, 0.8);
    expect(fx.iPositionAttr.updateRanges).toHaveLength(0);
    // Strictly greater, not merely non-empty: the walk reproduces the
    // previous values here, so a dropped forceFull would leave the version
    // untouched AND the range list empty.
    expect(fx.iPositionAttr.version).toBe(version + 1);
  });

  it('a flipped suppress verdict re-uploads as a bounded range', () => {
    const closeCamera = new THREE.Vector3(1.999, 0, 0);
    field.update(t0, closeCamera, 15, 1080, 0.8);
    expect(fx.compositeSuppress[2]).toBe(0);
    fx.iCompositeSuppressAttr.clearUpdateRanges();
    field.update(t0, idleCamera, 15, 1080, 0.8);
    expect(fx.compositeSuppress[2]).toBe(1);
    // Slot 0 is the shared primary and never suppresses; the control star
    // at slot 3 is untracked, so no range can reach it.
    expect(fx.iCompositeSuppressAttr.updateRanges).toEqual([{ start: 1, count: 2 }]);
  });

  it('a wholesale localPositions rewrite does not force the suppress buffer up', () => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    fx.iCompositeSuppressAttr.clearUpdateRanges();
    const version = fx.iCompositeSuppressAttr.version;
    fx.localPositions.set(fx.absolutePositions);
    field.markBaselinesDirty();
    field.update(t0, idleCamera, 15, 1080, 0.8);
    // The shell rewrites localPositions only — the gate verdicts this walk
    // reproduces are already on the GPU.
    expect(fx.iCompositeSuppressAttr.updateRanges).toHaveLength(0);
    expect(fx.iCompositeSuppressAttr.version).toBe(version);
  });

  it('markBaselinesDirty walk restores suppressed placements over a wholesale buffer rewrite', () => {
    field.update(t0, idleCamera, 15, 1080, 0.8);
    const placedX = fx.localPositions[2 * 3];
    // Epoch re-advance / recentre stand-in: every slot back to bare baseline.
    fx.localPositions.set(fx.absolutePositions);
    field.markBaselinesDirty();
    field.update(t0, idleCamera, 15, 1080, 0.8);
    expect(fx.localPositions[2 * 3]).toBe(placedX);
    expect(fx.compositeSuppress[2]).toBe(1);
  });
});
