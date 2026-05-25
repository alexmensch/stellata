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
import { SUB_PIXEL_THRESHOLD_PX } from './binary-tuning';

// Catalog stand-in: 4 stars at various ICRS positions. The first two
// form a Tier 1 outer pair; the last two are inactive controls.
function makeFixture(): {
  binaries: BinariesData;
  absolutePositions: Float32Array;
  absoluteMags: Float32Array;
  localPositions: Float32Array;
  compositeSuppress: Float32Array;
  iPositionAttr: THREE.InstancedBufferAttribute;
  iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
} {
  const positions = new Float32Array([
    2.0, 0.0, 0.0,   // 0: primary at 2 pc on +X (close enough to render)
    2.0, 0.0, 0.0,   // 1: secondary (inner barycentre representation)
    1.5, 0.5, 0.0,   // 2: outer-only secondary
    50.0, 0.0, 0.0,  // 3: far star (control)
  ]);
  const mags = new Float32Array([2.0, 5.0, 4.0, 6.0]);
  const local = new Float32Array(positions);
  const suppress = new Float32Array(4);

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
  const binaries: BinariesData = {
    version: 1,
    relations: [outer, inner],
    primaryIdxToRelations: new Map([[0, [0, 1]]]),
    secondaryIdxToRelation: new Map([[1, 1], [2, 0]]),
  };

  // Three.js attributes need only be carriers for the field's
  // needsUpdate flag — no GPU bound in vitest.
  const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
  const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);

  return {
    binaries,
    absolutePositions: positions,
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

  it('t = J2000: ΔR = 0, positions match catalog baseline exactly', () => {
    const tJ2000Unix = (J2000_JD - 2440587.5) * 86400;
    field.update(tJ2000Unix, closeCamera, 15, 1080, 0.8);
    for (let i = 0; i < fx.localPositions.length; i++) {
      expect(fx.localPositions[i]).toBeCloseTo(fx.absolutePositions[i], 10);
    }
  });

  it('t = J2000 + ¼ period: outer secondary moves off the baseline', () => {
    const tQuarter = (J2000_JD - 2440587.5) * 86400 + 0.25 * 365.25 * 100 * 86400;
    field.update(tQuarter, closeCamera, 15, 1080, 0.8);
    // Outer secondary is catalog idx 2; localPositions slice [6..9].
    const sDelta = [
      fx.localPositions[6] - fx.absolutePositions[6],
      fx.localPositions[7] - fx.absolutePositions[7],
      fx.localPositions[8] - fx.absolutePositions[8],
    ];
    const sMag = Math.hypot(...sDelta);
    // Outer a=10 AU, q=0.4 ⇒ secondary peak ≈ 0.6·a = 6 AU = 2.9e-5 pc.
    expect(sMag).toBeGreaterThan(1e-6);
    expect(sMag).toBeLessThan(1e-3);
  });

  it('one full outer period later, secondary returns to baseline (within 1e-9 pc)', () => {
    const tNext = (J2000_JD - 2440587.5) * 86400 + 365.25 * 100 * 86400;
    field.update(tNext, closeCamera, 15, 1080, 0.8);
    expect(fx.localPositions[6]).toBeCloseTo(fx.absolutePositions[6], 9);
    expect(fx.localPositions[7]).toBeCloseTo(fx.absolutePositions[7], 9);
    expect(fx.localPositions[8]).toBeCloseTo(fx.absolutePositions[8], 9);
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
      secondaryIdxToRelation: new Map([[1, 1], [2, 0]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    return {
      binaries,
      absolutePositions: positions,
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

  it('inner-pair offset clean when focal=inner secondary (Aa2 pin absorbs outer shift)', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8, 1);
    // Aa2 (idx 1) must stay pinned at its J2000 baseline.
    expect(fx.localPositions[3]).toBeCloseTo(fx.absolutePositions[3], 10);
    expect(fx.localPositions[4]).toBeCloseTo(fx.absolutePositions[4], 10);
    expect(fx.localPositions[5]).toBeCloseTo(fx.absolutePositions[5], 10);
    // Aa1's position should be at −ΔR_inner from Aa2 — outer perturbation
    // absorbed by the focal-pin.
    const innerSep = Math.hypot(
      fx.localPositions[3] - fx.localPositions[0],
      fx.localPositions[4] - fx.localPositions[1],
      fx.localPositions[5] - fx.localPositions[2],
    );
    expect(innerSep).toBeLessThanOrEqual(INNER_DISPLACEMENT_PC * 1.05);
    expect(innerSep).toBeLessThan(OUTER_PERTURB_PC * 0.1);
  });

  it('inner-pair offset clean when focal=inner primary (Aa1 pin)', () => {
    const fx = makeAlgolFixture();
    const field = new BinaryOrbitField(fx);
    field.update(tQuarter, closeCamera, 15, 1080, 0.8, 0);
    // Aa1 (idx 0) stays pinned at baseline.
    expect(fx.localPositions[0]).toBeCloseTo(fx.absolutePositions[0], 10);
    expect(fx.localPositions[1]).toBeCloseTo(fx.absolutePositions[1], 10);
    expect(fx.localPositions[2]).toBeCloseTo(fx.absolutePositions[2], 10);
    const innerSep = Math.hypot(
      fx.localPositions[3] - fx.localPositions[0],
      fx.localPositions[4] - fx.localPositions[1],
      fx.localPositions[5] - fx.localPositions[2],
    );
    expect(innerSep).toBeLessThanOrEqual(INNER_DISPLACEMENT_PC * 1.05);
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
    const local = new Float32Array(positions);
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
    const binaries: BinariesData = {
      version: 1,
      relations: [r],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelation: new Map([[1, 0]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    const field = new BinaryOrbitField({
      binaries,
      absolutePositions: positions,
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

describe('BinaryOrbitField.update — focal-star rebase', () => {
  // When the focal star is a member of a binary pair, anchor it at the
  // local origin (matching the disc shader's uPinFocusToCenter) and load
  // the FULL relative motion onto the companion. Without this the focus
  // ring / distance vector / hover pick all project to a perturbed point
  // separated from where the GPU pins the disc.

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
      secondaryIdxToRelation: new Map([[1, 0]]),
    };
    const iPositionAttr = new THREE.InstancedBufferAttribute(local, 3);
    const iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(suppress, 1);
    return {
      binaries,
      absolutePositions: positions,
      absoluteMags: mags,
      localPositions: local,
      compositeSuppress: suppress,
      iPositionAttr,
      iCompositeSuppressAttr,
    };
  }

  const closeCamera = new THREE.Vector3(1.999, 0, 0);
  const tNonZero = (J2000_JD - 2440587.5) * 86400 + 12 * 365.25 * 86400;

  it('focal=primary: primary stays at baseline, companion takes full ΔR', () => {
    const fxA = singleRelationFixture(0.4);
    const fieldA = new BinaryOrbitField(fxA);
    fieldA.update(tNonZero, closeCamera, 15, 1080, 0.8, 0);

    const fxB = singleRelationFixture(0.4);
    const fieldB = new BinaryOrbitField(fxB);
    fieldB.update(tNonZero, closeCamera, 15, 1080, 0.8, null);

    expect(fxA.localPositions[0]).toBeCloseTo(fxA.absolutePositions[0], 10);
    expect(fxA.localPositions[1]).toBeCloseTo(fxA.absolutePositions[1], 10);
    expect(fxA.localPositions[2]).toBeCloseTo(fxA.absolutePositions[2], 10);

    const sFull = Math.hypot(
      fxA.localPositions[3] - fxA.absolutePositions[3],
      fxA.localPositions[4] - fxA.absolutePositions[4],
      fxA.localPositions[5] - fxA.absolutePositions[5],
    );
    const sBary = Math.hypot(
      fxB.localPositions[3] - fxB.absolutePositions[3],
      fxB.localPositions[4] - fxB.absolutePositions[4],
      fxB.localPositions[5] - fxB.absolutePositions[5],
    );
    // q=0.4 ⇒ (1−q) = 0.6 ⇒ 1.0 / 0.6 ≈ 1.667.
    expect(sFull / sBary).toBeCloseTo(1 / 0.6, 2);
  });

  it('focal=secondary: secondary stays at baseline, primary takes full −ΔR', () => {
    const fxA = singleRelationFixture(0.4);
    const fieldA = new BinaryOrbitField(fxA);
    fieldA.update(tNonZero, closeCamera, 15, 1080, 0.8, 1);

    const fxB = singleRelationFixture(0.4);
    const fieldB = new BinaryOrbitField(fxB);
    fieldB.update(tNonZero, closeCamera, 15, 1080, 0.8, null);

    expect(fxA.localPositions[3]).toBeCloseTo(fxA.absolutePositions[3], 10);
    expect(fxA.localPositions[4]).toBeCloseTo(fxA.absolutePositions[4], 10);
    expect(fxA.localPositions[5]).toBeCloseTo(fxA.absolutePositions[5], 10);

    const pFull = Math.hypot(
      fxA.localPositions[0] - fxA.absolutePositions[0],
      fxA.localPositions[1] - fxA.absolutePositions[1],
      fxA.localPositions[2] - fxA.absolutePositions[2],
    );
    const pBary = Math.hypot(
      fxB.localPositions[0] - fxB.absolutePositions[0],
      fxB.localPositions[1] - fxB.absolutePositions[1],
      fxB.localPositions[2] - fxB.absolutePositions[2],
    );
    // q=0.4 ⇒ 1.0 / 0.4 = 2.5.
    expect(pFull / pBary).toBeCloseTo(1 / 0.4, 2);
  });

  it('focal=unrelated star: barycentric split preserved (no rebase)', () => {
    const fxA = singleRelationFixture(0.4);
    const fieldA = new BinaryOrbitField(fxA);
    fieldA.update(tNonZero, closeCamera, 15, 1080, 0.8, 99);

    const fxB = singleRelationFixture(0.4);
    const fieldB = new BinaryOrbitField(fxB);
    fieldB.update(tNonZero, closeCamera, 15, 1080, 0.8, null);

    for (let i = 0; i < fxA.localPositions.length; i++) {
      expect(fxA.localPositions[i]).toBeCloseTo(fxB.localPositions[i], 12);
    }
  });
});
