import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EclipsePhotometryField } from './eclipse-photometry';
import { DIM_FLOOR } from './eclipse-photometry-pure';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  NO_PARENT,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';
import { J2000_JD, AU_PC } from '../util/astronomy-constants';

/** Sim-time t (Unix seconds) for a Julian date — inverse of tToJDE. */
const tForJd = (jd: number) => (jd - 2440587.5) * 86400;

interface FixtureSpec {
  /** Pair orbital elements (edge-on defaults; override per test). */
  rel?: Partial<BinaryRelation>;
  /** Absolute positions for [primary, secondary, control]. */
  positions: Float32Array;
}

/** 3 stars (primary, secondary, control), one has_orbit pair.
 *  Primary absmag 2 / 10 R☉; secondary absmag 5 / 5 R☉. */
function makeFixture(spec: FixtureSpec) {
  const absoluteMags = new Float32Array([2.0, 5.0, 6.0]);
  const physicalRadiusSolar = new Float32Array([10, 5, 1]);
  const absolutePositions = spec.positions;
  const localPositions = new Float32Array(spec.positions);
  const eclipseDimBuffer = new Float32Array(3).fill(1);
  const iEclipseDimAttr = new THREE.InstancedBufferAttribute(eclipseDimBuffer, 1);

  const rel: BinaryRelation = {
    primaryIdx: 0,
    secondaryIdx: 1,
    flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
    parentRelation: NO_PARENT,
    pDays: 10,
    tJd: J2000_JD,
    e: 0,
    aAU: 1,
    iRad: Math.PI / 2,
    omegaRad: 0,
    OmegaRad: 0,
    q: 0.4,
    sepArcsec: 1,
    paDeg: 0,
    sepPaEpochJd: J2000_JD,
    ...spec.rel,
  };
  const binaries: BinariesData = {
    version: 1,
    relations: [rel],
    primaryIdxToRelations: new Map([[0, [0]]]),
    secondaryIdxToRelation: new Map([[1, 0]]),
  };

  return {
    binaries,
    absolutePositions,
    localPositions,
    absoluteMags,
    physicalRadiusSolar,
    eclipseDimBuffer,
    iEclipseDimAttr,
  };
}

/** Edge-on pair at (10,0,0) pc: i=π/2, ω=Ω=0, e=0 puts the orbit in the
 *  north(z) × radial(x) plane, which contains the Sol line of sight.
 *  Conjunctions from the origin land at T ± P/4: at T+P/4 the secondary
 *  is behind the primary (receding radial), at T+3P/4 in front. The
 *  secondary is baked at the pair's T-epoch offset (+a north) so the
 *  rendered offset equals R(t) exactly. */
function edgeOnFixture() {
  const aPc = 1 * AU_PC;
  return makeFixture({
    positions: new Float32Array([
      10, 0, 0,
      10, 0, Math.fround(aPc),
      100, 0, 0,
    ]),
  });
}

const CAM = new THREE.Vector3(0, 0, 0);

describe('EclipsePhotometryField construction', () => {
  it('caches one entry per has_orbit relation', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    expect(field.cachedRelations).toHaveLength(1);
  });

  it('derives a view-direction prefilter tighter than "always evaluate"', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const rc = field.cachedRelations[0];
    expect(rc.normal).not.toBeNull();
    expect(rc.sinLimit).toBeLessThan(1);
    expect(rc.sinLimit).toBeGreaterThan(0);
  });
});

describe('EclipsePhotometryField.update — conjunction geometry', () => {
  it('dims the secondary at superior conjunction (secondary behind)', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    field.update(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    // Secondary (5 R☉) fully covered by the primary's larger disc.
    expect(fx.eclipseDimBuffer[1]).toBeCloseTo(DIM_FLOOR, 8);
    expect(fx.eclipseDimBuffer[0]).toBe(1);
  });

  it('dims the primary at inferior conjunction (secondary in front) — the two minima differ', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    field.update(tForJd(J2000_JD + 7.5), CAM, 6, 0);
    // Smaller front disc on the larger back disc: annular, dim =
    // 1 − (alpha_sec / alpha_pri)² = 1 − (5/10)² = 0.75.
    expect(fx.eclipseDimBuffer[0]).toBeCloseTo(0.75, 3);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });

  it('no dim away from conjunction', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    field.update(tForJd(J2000_JD), CAM, 6, 0);
    expect(fx.eclipseDimBuffer[0]).toBe(1);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });

  it('no dim when viewing down the orbit normal, at any phase', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const camOnNormal = new THREE.Vector3(10, 5, 0);
    for (let k = 0; k < 8; k++) {
      field.update(tForJd(J2000_JD + (10 * k) / 8), camOnNormal, 6, k * 16);
      expect(fx.eclipseDimBuffer[0]).toBe(1);
      expect(fx.eclipseDimBuffer[1]).toBe(1);
    }
  });
});

describe('EclipsePhotometryField.update — float32 position immunity', () => {
  it('never reports an eclipse for a face-on pair baked collocated at 25 pc', () => {
    // The user-visible regression: a pair whose float32 catalog
    // positions are identical (separation below the 0.6 AU float32
    // quantum at 25 pc). Deriving geometry from buffer positions reads
    // θ = 0 → spurious full eclipse, flickering with grid alignment.
    // The orbital offset says the true geometry (face-on from the
    // origin, 0.08 AU separation, ~3 R☉ discs) never overlaps.
    const c = Math.fround(25 / Math.sqrt(3));
    const fx = makeFixture({
      positions: new Float32Array([c, c, c, c, c, c, 100, 0, 0]),
      rel: {
        aAU: 0.08,
        pDays: 3.96,
        iRad: 0,
      },
    });
    fx.physicalRadiusSolar.set([2.8, 2.6, 1]);
    const field = new EclipsePhotometryField(fx);
    // k = 2..30: near k = 0 the collocated baking makes the rendered
    // offset (R(t) − R(T)) genuinely smaller than the disc radii — a
    // real overlap in the rendered model (the baked-baseline data bug,
    // tracked separately), not float32 noise.
    for (let k = 2; k <= 30; k++) {
      const jd = J2000_JD + (3.96 * k) / 32;
      const jitter = new THREE.Vector3(1e-5 * Math.sin(k), 1e-5 * Math.cos(k), 0);
      field.update(tForJd(jd), jitter, 6, k * 16);
      expect(fx.eclipseDimBuffer[0]).toBe(1);
      expect(fx.eclipseDimBuffer[1]).toBe(1);
    }
  });
});

describe('EclipsePhotometryField.update — anti-strobe smoothing', () => {
  it('first frame snaps, later frames blend toward the target', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    field.update(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    expect(fx.eclipseDimBuffer[1]).toBeCloseTo(DIM_FLOOR, 8);
    // Occlusion ends; 16 ms later the dim has only partially recovered.
    field.update(tForJd(J2000_JD), CAM, 6, 16);
    expect(fx.eclipseDimBuffer[1]).toBeGreaterThan(DIM_FLOOR);
    expect(fx.eclipseDimBuffer[1]).toBeLessThan(0.5);
  });

  it('a cleared occlusion decays to exactly 1 and leaves the active set', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    field.update(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    for (let n = 1; n <= 200; n++) {
      field.update(tForJd(J2000_JD), CAM, 6, n * 16);
    }
    expect(fx.eclipseDimBuffer[1]).toBe(1);
    // Settled: no further writes → the attribute stops re-uploading.
    const version = fx.iEclipseDimAttr.version;
    field.update(tForJd(J2000_JD), CAM, 6, 201 * 16);
    expect(fx.iEclipseDimAttr.version).toBe(version);
  });
});

describe('EclipsePhotometryField.update — attribute upload gating', () => {
  it('does not flag needsUpdate on frames with nothing to write', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const version = fx.iEclipseDimAttr.version;
    field.update(tForJd(J2000_JD), CAM, 6, 0);
    expect(fx.iEclipseDimAttr.version).toBe(version);
  });

  it('flags needsUpdate when a dim is written', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const version = fx.iEclipseDimAttr.version;
    field.update(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    expect(fx.iEclipseDimAttr.version).toBeGreaterThan(version);
  });
});

describe('EclipsePhotometryField.debugRows', () => {
  it('reports the plane gate with the failing dot product', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const camOnNormal = new THREE.Vector3(10, 5, 0);
    const rows = field.debugRows(tForJd(J2000_JD + 2.5), camOnNormal, 6, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toBe('plane');
    expect(rows[0].planeDot!).toBeGreaterThan(rows[0].sinLimit);
    expect(rows[0].result).toBeNull();
  });

  it('reports clear geometry with the rendered separation at conjunction', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    const rows = field.debugRows(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toBe('clear');
    expect(rows[0].result!.dim).toBeLessThan(1);
    expect(rows[0].result!.front).toBe('primary');
    expect(rows[0].relPc).toBeCloseTo(AU_PC, 9);
    expect(rows[0].discSumPc).toBeGreaterThan(0);
  });

  it('filters by star index and writes nothing to the dim buffer', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    expect(field.debugRows(tForJd(J2000_JD + 2.5), CAM, 6, 2)).toHaveLength(0);
    field.debugRows(tForJd(J2000_JD + 2.5), CAM, 6, 0);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });
});

describe('EclipsePhotometryField.update — visibility prefilter', () => {
  it('skips relations whose primary is below the magnitude limit', () => {
    const fx = edgeOnFixture();
    const field = new EclipsePhotometryField(fx);
    // appMag for primary at d=10pc with absmag=2 equals 2 (5·log10(10/10)=0).
    // Set maxAppMag to 0 → prefilter rejects (0.5 < 2).
    field.update(tForJd(J2000_JD + 2.5), CAM, 0, 0);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });
});
