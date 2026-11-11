import { describe, expect, it } from 'vitest';
import {
  applySystemCoherence,
  COHERENCE_RADIAL_SIGMA,
  systemCoherenceVerdicts,
  type CoherenceSources,
} from './system-coherence';
import { COHERENCE_CODES, coherenceFigures, coherenceLineageLines } from './coherence-lineage-pure';
import { foldStageLines } from '../lineage/lineage-row-pure';
import type { Star } from '../parse/stars-parse';
import { makeStar } from '../parse/star-fixture';
import type { Hip2AstrometryRow } from '../sources/hip2-source';
import type { GaiaAstrometryCatalogRow } from '../sources/gaia-astrometry-source';
import { gaiaAstrometryRow } from '../sources/gaia-astrometry-fixture';
import { HIP2 } from '../sources/hip2-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import type { MultiplesTsvRow } from '../companions/companion-promotion';
import { multiplesRow } from '../companions/multiples-fixture';
import { BAILER_JONES } from '../distance/refinement/bailer-jones-source';

function coherence(rows: MultiplesTsvRow[], stars: Star[], src: CoherenceSources) {
  const verdicts = systemCoherenceVerdicts(rows, stars, src);
  const counts = foldStageLines(COHERENCE_CODES, coherenceLineageLines(verdicts, stars));
  applySystemCoherence(stars, verdicts);
  return coherenceFigures(counts);
}

function star(overrides: Partial<Star>): Star {
  return makeStar({
    absmag: 5, ci: 0.65, spectral: { kind: 'mk', letter: 4, subclass: null, lumClass: 2 }, conIndex: 0, ...overrides,
  });
}

function pairRow(
  overrides: Partial<MultiplesTsvRow> & { systemId: string; comp: string },
): MultiplesTsvRow {
  return multiplesRow({
    x_pc: null, y_pc: null, z_pc: null, absmag: null, ci: null,
    source: 'athyg', photometryVia: 'none', orbitRole: 'primary', distPc: null,
    ...overrides,
  });
}

function gaiaRow(
  overrides: Partial<GaiaAstrometryCatalogRow>,
): GaiaAstrometryCatalogRow {
  return gaiaAstrometryRow({
    parallaxMas: 10, parallaxErrorMas: 0.1,
    pmraMasyr: 0, pmdecMasyr: 0, ruwe: 1.0, ipdFracMultiPeak: 0, gMag: 8,
    ...overrides,
  });
}

function hip2Row(overrides: Partial<Hip2AstrometryRow>): Hip2AstrometryRow {
  return {
    raDeg: 0, decDeg: 0, plxMas: 10, plxErrorMas: 0.5,
    pmRaMasyr: 0, pmDeMasyr: 0,
    ref: sourceRowRef(HIP2, 1),
    ...overrides,
  };
}

function sources(o: Partial<CoherenceSources> = {}): CoherenceSources {
  return {
    gaiaAstrometry: new Map(), hip2: new Map(), bailerJones: { source: BAILER_JONES, distPc: new Map() },
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

describe('system distance coherence', () => {
  it('snaps an insignificant radial gap to the anchor distance (Acrux)', () => {
    const { primary, member, stars, rows, src } = acruxFixture();
    const stats = coherence(rows, stars, src);
    expect(stats.systems).toBe(1);
    expect(stats.repositioned).toBe(1);
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
    coherence(rows, stars, src);
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
    const stats = coherence(rows, [primary, member], src);
    expect(stats.depthKept).toBe(1);
    expect(stats.repositioned).toBe(0);
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
    const stats = coherence(rows, [primary, member], src);
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
    const stats = coherence(rows, [primary, member], src);
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
    const stats = coherence(rows, [a, b, c], sources());
    expect(stats.systems).toBe(0);
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
    const stats = coherence(rows, [primary, member], src);
    expect(stats.repositioned).toBe(1);
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
    const stats = coherence(rows, [primary, member], src);
    expect(stats.anchorInconsistent).toBe(1);
    expect(stats.repositioned).toBe(0);
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
    const stats = coherence(rows, [primary, member], src);
    expect(stats.repositioned).toBe(0);
    expect(stats.depthKept).toBe(1);
    expect(member.x).toBeCloseTo(176.6, 6);
  });
});

describe('member-anchor precision veto', () => {
  function polarisShape(
    memberPlx: { parallaxMas: number; parallaxErrorMas: number },
    primaryPlx: { plxMas: number; plxErrorMas: number },
  ) {
    const primary = star({ hip: 11767, x: 132.626 });
    const member = star({ gaiaSourceId: '576', x: 137.233 });
    const rows = [
      pairRow({ systemId: '02318+8916-AB', comp: 'A', hip: 11767 }),
      pairRow({
        systemId: '02318+8916-AB', comp: 'B', gaiaSourceId: '576',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[11767, hip2Row(primaryPlx)]]),
      gaiaAstrometry: new Map([['576', gaiaRow(memberPlx)]]),
    });
    return {
      primary, member,
      stats: coherence(rows, [primary, member], src),
    };
  }

  it('lets a better-measured member take the anchor (Polaris B)', () => {
    const { primary, stats } = polarisShape(
      { parallaxMas: 7.2869, parallaxErrorMas: 0.0178 },
      { plxMas: 7.54, plxErrorMas: 0.11 },
    );
    expect(stats.memberAnchorWins).toBe(1);
    expect(stats.precisionVetoed).toBe(0);
    expect(primary.x).toBeCloseTo(137.233, 6);
  });

  it('vetoes a member whose own parallax is looser than the primary', () => {
    const { primary, member, stats } = polarisShape(
      { parallaxMas: 7.2869, parallaxErrorMas: 0.2915 },
      { plxMas: 7.54, plxErrorMas: 0.11 },
    );
    expect(stats.memberAnchorWins).toBe(0);
    expect(stats.precisionVetoed).toBe(1);
    expect(primary.x).toBeCloseTo(132.626, 6);
    expect(member.x).toBeCloseTo(132.626, 6);
  });

  it('never credits a primary with a parallax its own sub-pair corrupts', () => {
    // HIP2's 2.0% is what the primary can stand behind, not its own 0.01%.
    const primary = star({ hip: 300, gaiaSourceId: '1', x: 50 });
    const member = star({ gaiaSourceId: '2', x: 50.2 });
    const rows = [
      pairRow({ systemId: '00002+0002-AB', comp: 'A', hip: 300, gaiaSourceId: '1' }),
      pairRow({
        systemId: '00002+0002-AB', comp: 'B', gaiaSourceId: '2',
        orbitRole: 'secondary',
      }),
      pairRow({ systemId: '00002+0002-Aa,Ab', comp: 'Aa', gaiaSourceId: '1' }),
      pairRow({
        systemId: '00002+0002-Aa,Ab', comp: 'Ab', gaiaSourceId: '1',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      hip2: new Map([[300, hip2Row({ plxMas: 20, plxErrorMas: 0.4 })]]),
      gaiaAstrometry: new Map([
        ['1', gaiaRow({ parallaxMas: 20, parallaxErrorMas: 0.002 })],
        ['2', gaiaRow({ parallaxMas: 19.9203, parallaxErrorMas: 0.0996 })],
      ]),
    });
    const stats = coherence(rows, [primary, member], src);
    expect(stats.memberAnchorWins).toBe(1);
    expect(stats.precisionVetoed).toBe(0);
    expect(primary.x).toBeCloseTo(50.2, 6);
  });

  it('ranks same-tier pair primaries on parallax precision before letter (gamma Vel)', () => {
    const a = star({ hip: 39953, x: 342.466 });
    const b = star({ gaiaSourceId: '5519266900766220800', x: 392.293 });
    const c = star({ gaiaSourceId: '5519219999721187968', x: 340.1 });
    const rows = [
      pairRow({ systemId: '08095-4720-AB', comp: 'A', hip: 39953 }),
      pairRow({
        systemId: '08095-4720-AB', comp: 'B', gaiaSourceId: '5519266900766220800',
        orbitRole: 'secondary',
      }),
      pairRow({ systemId: '08095-4720-BC', comp: 'B', gaiaSourceId: '5519266900766220800' }),
      pairRow({
        systemId: '08095-4720-BC', comp: 'C', gaiaSourceId: '5519219999721187968',
        orbitRole: 'secondary',
      }),
      pairRow({ systemId: '08095-4720-CD', comp: 'C', gaiaSourceId: '5519219999721187968' }),
    ];
    const src = sources({
      hip2: new Map([[39953, hip2Row({ plxMas: 2.92, plxErrorMas: 0.30 })]]),
      gaiaAstrometry: new Map([
        ['5519266900766220800', gaiaRow({ parallaxMas: 2.6052, parallaxErrorMas: 0.1235 })],
        ['5519219999721187968', gaiaRow({ parallaxMas: 2.9193, parallaxErrorMas: 0.0348 })],
      ]),
    });
    const stats = coherence(rows, [a, b, c], src);
    expect(stats.repositioned).toBe(2);
    expect(a.x).toBeCloseTo(340.1, 6);
    expect(b.x).toBeCloseTo(340.1, 6);
    expect(c.x).toBeCloseTo(340.1, 6);
  });

  it('keeps a pair primary as anchor over a more precise secondary-only member (GJ 4)', () => {
    const a = star({ hip: 473, gaiaSourceId: '386653851004022144', x: 11.521 });
    const b = star({ gaiaSourceId: '386653747925624576', x: 11.51 });
    const f = star({ hip: 428, gaiaSourceId: '386655019234959872', x: 11.503 });
    const rows = [
      pairRow({ systemId: '00057+4549-AB', comp: 'A', hip: 473, gaiaSourceId: '386653851004022144' }),
      pairRow({
        systemId: '00057+4549-AB', comp: 'B', gaiaSourceId: '386653747925624576',
        orbitRole: 'secondary',
      }),
      pairRow({ systemId: '00057+4549-AF', comp: 'A', hip: 473, gaiaSourceId: '386653851004022144' }),
      pairRow({
        systemId: '00057+4549-AF', comp: 'F', hip: 428, gaiaSourceId: '386655019234959872',
        orbitRole: 'secondary',
      }),
    ];
    const src = sources({
      gaiaAstrometry: new Map([
        ['386653851004022144', gaiaRow({ parallaxMas: 86.8003, parallaxErrorMas: 0.0243 })],
        ['386653747925624576', gaiaRow({ parallaxMas: 86.8206, parallaxErrorMas: 0.0297 })],
        ['386655019234959872', gaiaRow({ parallaxMas: 86.9299, parallaxErrorMas: 0.017 })],
      ]),
    });
    const stats = coherence(rows, [a, b, f], src);
    expect(stats.memberAnchorWins).toBe(0);
    expect(stats.depthKept).toBe(1);
    expect(b.x).toBeCloseTo(11.521, 6);
    expect(f.x).toBeCloseTo(11.503, 6);
  });
});

describe('systemCoherenceVerdicts', () => {
  it('names the anchor, its tier and row, and each member\'s move (Polaris)', () => {
    const primary = star({ hip: 11767, x: 132.626 });
    const member = star({ gaiaSourceId: '576', x: 137.233 });
    const rows = [
      pairRow({ systemId: '02318+8916-AB', comp: 'A', hip: 11767 }),
      pairRow({ systemId: '02318+8916-AB', comp: 'B', gaiaSourceId: '576', orbitRole: 'secondary' }),
    ];
    const gaia = gaiaRow({ parallaxMas: 7.2869, parallaxErrorMas: 0.0178 });
    const src = sources({
      hip2: new Map([[11767, hip2Row({ plxMas: 7.54, plxErrorMas: 0.11 })]]),
      gaiaAstrometry: new Map([['576', gaia]]),
    });
    expect(systemCoherenceVerdicts(rows, [primary, member], src)).toEqual([{
      kind: 'coherent', root: '02318+8916', anchorPc: 137.233,
      anchor: { idx: 1, tier: 'gaia-clean', ref: gaia.ref, memberWon: true, precisionVetoed: false },
      members: [{ kind: 'snapped', idx: 0, fromPc: 132.626, toPc: 137.233 }],
    }]);
    expect(primary.x).toBe(132.626);
  });

  it('decides a later system on an earlier system\'s snapped distance, as applied', () => {
    const a = star({ hip: 100, x: 50 });
    const b = star({ hip: 200, x: 51, y: 3 });
    const c = star({ hip: 300, x: 52 });
    const rows = [
      pairRow({ systemId: '00001+0001-AB', comp: 'A', hip: 100 }),
      pairRow({ systemId: '00001+0001-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
      pairRow({ systemId: '00002+0002-AB', comp: 'A', hip: 200 }),
      pairRow({ systemId: '00002+0002-AB', comp: 'B', hip: 300, orbitRole: 'secondary' }),
    ];
    const stars = [a, b, c];
    const verdicts = systemCoherenceVerdicts(rows, stars, sources());
    applySystemCoherence(stars, verdicts);
    const second = verdicts[1];
    if (second.kind !== 'coherent') throw new Error(`expected a coherent second system, got ${second.kind}`);
    expect(second.anchor.idx).toBe(1);
    expect(second.anchorPc).toBe(Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z));
    expect(Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z)).toBeCloseTo(second.anchorPc, 12);
  });

  it('cites the Bailer-Jones row for that tier, and no row for an inherited anchor', () => {
    const a = star({ gaiaSourceId: '7', x: 50 });
    const b = star({ hip: 9, x: 50.5 });
    const rows = [
      pairRow({ systemId: '00003+0003-AB', comp: 'A', gaiaSourceId: '7' }),
      pairRow({ systemId: '00003+0003-AB', comp: 'B', hip: 9, orbitRole: 'secondary' }),
    ];
    const bj = sources({ bailerJones: { source: BAILER_JONES, distPc: new Map([['7', 50]]) } });
    const [withBj] = systemCoherenceVerdicts(rows, [a, b], bj);
    expect(withBj.anchor).toMatchObject({ idx: 0, tier: 'bailer-jones', ref: { source: BAILER_JONES, row: '7' } });
    const [inherited] = systemCoherenceVerdicts(rows, [a, b], sources());
    expect(inherited.anchor).toEqual({ idx: 0, tier: 'inherited', memberWon: false, precisionVetoed: false });
  });
});
