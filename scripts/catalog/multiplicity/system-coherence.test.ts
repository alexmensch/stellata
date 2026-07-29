import { describe, expect, it } from 'vitest';
import {
  applySystemDistanceCoherence,
  COHERENCE_RADIAL_SIGMA,
  type CoherenceSources,
} from './system-coherence';
import type { Star } from '../parse/stars-parse';
import { makeStar } from '../parse/star-fixture';
import type {
  GaiaAstrometryCatalogRow,
  Hip2AstrometryRow,
} from '../distance/direction-cascade';
import type { MultiplesTsvRow } from '../companions/companion-promotion';

function star(overrides: Partial<Star>): Star {
  return makeStar({
    absmag: 5, ci: 0.65, spectClass: 4, lumClass: 2, conIndex: 0, ...overrides,
  });
}

function pairRow(
  overrides: Partial<MultiplesTsvRow> & { systemId: string; comp: string },
): MultiplesTsvRow {
  return {
    hip: null, gaiaSourceId: null, hd: null,
    x_pc: null, y_pc: null, z_pc: null, absmag: null, ci: null,
    spect: '', name: '', source: 'athyg',
    astrometryVia: 'gaia_5p', spectVia: 'none', photometryVia: 'none',
    orbitRole: 'primary', distPc: null,
    pDays: null, tJd: null, e: null, aAU: null, iRad: null,
    omegaRad: null, q: null,
    sepArcsec: null, paDeg: null, sepPaEpochJd: null, dmag: null,
    anchorSepArcsec: null, anchorPaDeg: null, magPri: null, magSec: null,
    ...overrides,
  };
}

function gaiaRow(
  overrides: Partial<GaiaAstrometryCatalogRow>,
): GaiaAstrometryCatalogRow {
  return {
    raDeg: 0, decDeg: 0, parallaxMas: 10, parallaxErrorMas: 0.1,
    pmraMasyr: 0, pmdecMasyr: 0, ruwe: 1.0, ipdFracMultiPeak: 0, gMag: 8,
    bpMag: null, rpMag: null,
    ...overrides,
  };
}

function hip2Row(overrides: Partial<Hip2AstrometryRow>): Hip2AstrometryRow {
  return {
    raDeg: 0, decDeg: 0, plxMas: 10, plxErrorMas: 0.5,
    pmRaMasyr: 0, pmDeMasyr: 0,
    ...overrides,
  };
}

function sources(o: Partial<CoherenceSources> = {}): CoherenceSources {
  return {
    gaiaAstrometry: new Map(), hip2: new Map(), bjMap: new Map(),
    ...o,
  };
}

// Acrux shape: HIP2 primary at 98.72 pc; member C at 106.42 pc whose
// Gaia parallax passes the RUWE gate (1.32) but who hosts its own
// Ca,Cb sub-pair — an unresolved close binary, so never anchor-tier-1
// — and whose 7.7 pc gap is not a 3σ measurement.
function acruxFixture() {
  const primary = star({ hip: 60718, x: 98.72, absmag: -3.77 });
  const member = star({
    gaiaSourceId: '600', x: 106.42, absmag: -2.5, physicalRadius: 8,
  });
  const stars = [primary, member];
  const rows = [
    pairRow({ systemId: '12266-6306-AC', comp: 'A', hip: 60718 }),
    pairRow({
      systemId: '12266-6306-AC', comp: 'C', gaiaSourceId: '600',
      orbitRole: 'secondary',
    }),
    pairRow({ systemId: '12266-6306-Ca,Cb', comp: 'Ca', gaiaSourceId: '600' }),
    pairRow({
      systemId: '12266-6306-Ca,Cb', comp: 'Cb', gaiaSourceId: '600',
      orbitRole: 'secondary',
    }),
  ];
  const src = sources({
    hip2: new Map([[60718, hip2Row({ plxMas: 10.13, plxErrorMas: 0.5 })]]),
    gaiaAstrometry: new Map([
      ['600', gaiaRow({ parallaxMas: 9.397, parallaxErrorMas: 0.3, ruwe: 1.32 })],
    ]),
  });
  return { primary, member, stars, rows, src };
}

describe('applySystemDistanceCoherence', () => {
  it('snaps an insignificant radial gap to the anchor distance (Acrux)', () => {
    const { primary, member, stars, rows, src } = acruxFixture();
    const stats = applySystemDistanceCoherence(rows, stars, src);
    expect(stats.systemsProcessed).toBe(1);
    expect(stats.membersRepositioned).toBe(1);
    expect(stats.memberAnchorWins).toBe(0);
    expect(member.x).toBeCloseTo(98.72, 6);
    expect(primary.x).toBeCloseTo(98.72, 6);
    // Apparent brightness invariant: M += 5·log10(d_old/d_new).
    expect(member.absmag).toBeCloseTo(-2.5 + 5 * Math.log10(106.42 / 98.72), 6);
    // R ∝ √L at fixed Teff.
    expect(member.physicalRadius).toBeCloseTo(
      8 * Math.pow(10, -5 * Math.log10(106.42 / 98.72) / 5), 6,
    );
  });

  it('preserves the member direction, moving only radially', () => {
    const { stars, rows, src } = acruxFixture();
    const member = stars[1];
    member.x = 60;
    member.y = 80;
    member.z = 30; // |xyz| = 104.4
    applySystemDistanceCoherence(rows, stars, src);
    const d = Math.hypot(member.x, member.y, member.z);
    expect(d).toBeCloseTo(98.72, 6);
    expect(member.y / member.x).toBeCloseTo(80 / 60, 9);
    expect(member.z / member.x).toBeCloseTo(30 / 60, 9);
  });

  it('keeps a ≥3σ-measured depth (α Cen–Proxima / 61 Cyg shape)', () => {
    const primary = star({ gaiaSourceId: '1', x: 1.34, absmag: 4.38 });
    const member = star({ gaiaSourceId: '2', x: 1.3013, absmag: 15.5 });
    const rows = [
      pairRow({ systemId: '14396-6050-AC', comp: 'A', gaiaSourceId: '1' }),
      pairRow({
        systemId: '14396-6050-AC', comp: 'C', gaiaSourceId: '2',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      gaiaAstrometry: new Map([
        ['1', gaiaRow({ parallaxMas: 746.3, parallaxErrorMas: 0.03 })],
        ['2', gaiaRow({ parallaxMas: 768.5, parallaxErrorMas: 0.02 })],
      ]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.significantDepthKept).toBe(1);
    expect(stats.membersRepositioned).toBe(0);
    expect(member.x).toBeCloseTo(1.3013, 9);
  });

  it('lets a clean unsaturated Gaia member out-anchor a HIP2 primary', () => {
    const primary = star({ hip: 100, x: 50, absmag: 1 });
    const member = star({ gaiaSourceId: '9', x: 52, absmag: 6 });
    const rows = [
      pairRow({ systemId: '00001+0001-AB', comp: 'A', hip: 100 }),
      pairRow({
        systemId: '00001+0001-AB', comp: 'B', gaiaSourceId: '9',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[100, hip2Row({ plxMas: 20, plxErrorMas: 0.8 })]]),
      gaiaAstrometry: new Map([
        ['9', gaiaRow({ parallaxMas: 19.23, parallaxErrorMas: 0.05 })],
      ]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.memberAnchorWins).toBe(1);
    expect(primary.x).toBeCloseTo(52, 6);
    expect(member.x).toBeCloseTo(52, 9);
  });

  it('a saturated (G < 3) Gaia member never anchors', () => {
    const primary = star({ hip: 100, x: 50 });
    const member = star({ gaiaSourceId: '9', x: 52 });
    const rows = [
      pairRow({ systemId: '00001+0001-AB', comp: 'A', hip: 100 }),
      pairRow({
        systemId: '00001+0001-AB', comp: 'B', gaiaSourceId: '9',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[100, hip2Row({ plxMas: 20, plxErrorMas: 0.8 })]]),
      gaiaAstrometry: new Map([
        ['9', gaiaRow({ parallaxMas: 19.23, parallaxErrorMas: 0.05, gMag: 1.5 })],
      ]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.memberAnchorWins).toBe(0);
    // Gap 50 vs 52 at σ≈2 pc (HIP2-dominated) is insignificant → snap.
    expect(member.x).toBeCloseTo(50, 6);
  });

  it('ignores standalone rows, compound comps, and single-member systems', () => {
    const a = star({ gaiaSourceId: '1', x: 50 });
    const b = star({ gaiaSourceId: '2', x: 300 });
    const c = star({ gaiaSourceId: '3', x: 55 });
    const rows = [
      // Standalone: 40 Eri _D-shape background star — never snapped.
      pairRow({
        systemId: '00001+0001-_D', comp: 'D', gaiaSourceId: '2',
        orbitRole: 'standalone',
      }),
      pairRow({ systemId: '00001+0001-AB', comp: 'A', gaiaSourceId: '1' }),
      // Compound aggregate side — not a single star.
      pairRow({
        systemId: '00001+0001-A,BC', comp: 'BC', gaiaSourceId: '3',
        orbitRole: 'secondary',
      }),
    ];
    const stats = applySystemDistanceCoherence(rows, [a, b, c], sources());
    expect(stats.systemsProcessed).toBe(0);
    expect(b.x).toBe(300);
    expect(c.x).toBe(55);
  });

  it('members without a parallax error model snap within the gap bound', () => {
    const primary = star({ hip: 100, x: 50 });
    const member = star({ hip: 200, x: 54 });
    const rows = [
      pairRow({ systemId: '00001+0001-AB', comp: 'A', hip: 100 }),
      pairRow({
        systemId: '00001+0001-AB', comp: 'B', hip: 200,
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[100, hip2Row({ plxMas: 20, plxErrorMas: 0.5 })]]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.membersRepositioned).toBe(1);
    expect(member.x).toBeCloseTo(50, 6);
    expect(COHERENCE_RADIAL_SIGMA).toBe(3.0);
  });

  it('skips a system whose anchor placement contradicts its own parallax (μ¹/μ² Sco)', () => {
    // μ¹ Sco: RUWE-corrupted Gaia parallax (1.87 ± 0.74 mas → 534 pc,
    // σ_pc ≈ 210) but a B-J catalog placement at 1685.7 pc. The huge σ
    // makes μ² Sco's honest 176.6 pc read as a <3σ gap — but the
    // anchor's own placement is >3σ AND >20% off its parallax, so the
    // whole system is skipped and μ² keeps its distance.
    const primary = star({ hip: 82514, gaiaSourceId: '100', x: 1685.7 });
    const member = star({ gaiaSourceId: '200', x: 176.6 });
    const rows = [
      pairRow({ systemId: '16519-3803-AH', comp: 'A', hip: 82514, gaiaSourceId: '100' }),
      pairRow({
        systemId: '16519-3803-AH', comp: 'H', gaiaSourceId: '200',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[82514, hip2Row({ plxMas: 6.51, plxErrorMas: 0.91 })]]),
      gaiaAstrometry: new Map([
        ['100', gaiaRow({ parallaxMas: 1.8732, parallaxErrorMas: 0.7355, ruwe: 2.09 })],
        ['200', gaiaRow({ parallaxMas: 5.6632, parallaxErrorMas: 0.275, ruwe: 2.16 })],
      ]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.anchorPlacementInconsistent).toBe(1);
    expect(stats.membersRepositioned).toBe(0);
    expect(member.x).toBeCloseTo(176.6, 6);
    expect(primary.x).toBeCloseTo(1685.7, 6);
  });

  it('a wide gap with no error model keeps the member distance (μ² Sco)', () => {
    const primary = star({ hip: 100, x: 1686 });
    const member = star({ hip: 200, x: 176.6 });
    const rows = [
      pairRow({ systemId: '00001+0001-AB', comp: 'A', hip: 100 }),
      pairRow({
        systemId: '00001+0001-AB', comp: 'B', hip: 200,
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[100, hip2Row({ plxMas: 0.59, plxErrorMas: 0.4 })]]),
    });
    const stats = applySystemDistanceCoherence(rows, [primary, member], src);
    expect(stats.membersRepositioned).toBe(0);
    expect(stats.significantDepthKept).toBe(1);
    expect(member.x).toBeCloseTo(176.6, 6);
  });
});
