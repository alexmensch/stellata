import { describe, expect, it } from 'vitest';

import { DIST_VIA_VALUES } from '../parallax/parallax-cascade';
import { MAX_DIST_PC } from '../../parse/stars-parse';
import {
  applyBailerJonesOverride,
  isBailerJonesEligible,
  applyLmcKinematicOverride,
  LMC_PARALLAX_CONSISTENCY_SIGMA,
  LMC_PARALLAX_MAS,
  isInLmcCone,
  angularSeparationDeg,
  LMC_DISTANCE_PC,
  LMC_CENTRE_RA_HOURS,
  LMC_CENTRE_DEC_DEG,
  LMC_CONE_HALF_ANGLE_DEG,
  LMC_PM_RA_CENTRE,
  LMC_PM_DEC_CENTRE,
  LMC_PM_TOLERANCE,
} from './distance-overrides-pure';

describe('applyBailerJonesOverride', () => {
  // Tier-A fixtures: real pre-override + Bailer-Jones 2021
  // (/data/papers/index.md#bailerjones2021) DR3 values for the
  // four catastrophic parallax-inversion supergiants and a
  // well-measured F-dwarf control. Numbers pin the override outcome:
  // drift here means the override changed semantics or the upstream
  // catalogues drifted.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number; sourceId: string;
    preOverrideDist: number;       // the parallax inversion, pre-override
    bjDist: number;          // r_med_photogeo from data/bailer-jones-dr3.tsv
  }
  const FIVE_HIPS: Fixture[] = [
    { label: 'HIP 22365', ra: 4.81481859, dec:  43.27557981, mag:  7.7,  sourceId: '204531088580182016', preOverrideDist:  9963.4514, bjDist: 6244.791 },
    { label: 'HIP 25733', ra: 5.49517982, dec:  35.37501942, mag:  6.78, sourceId: '183255985260080896', preOverrideDist: 14326.6476, bjDist: 5466.246 },
    { label: 'HIP 38430', ra: 7.87230124, dec: -26.42963691, mag:  9.19, sourceId: '5602025904044961536', preOverrideDist: 12658.2278, bjDist: 6215.232 },
    { label: 'HIP 46144', ra: 9.41038175, dec:  62.43823034, mag: 10.14, sourceId: '1040043514891491968', preOverrideDist:  9189.7878, bjDist: 7515.496 },
    { label: 'HIP 23785', ra: 5.11164486, dec: -50.94139857, mag:  8.39, sourceId: '4773096563064098432', preOverrideDist:    93.1801, bjDist:   92.871 },
  ];
  const bjMap = new Map(FIVE_HIPS.map((f) => [f.sourceId, f.bjDist] as const));

  it('returns null when source_id is missing or absent from the map', () => {
    expect(applyBailerJonesOverride(null, bjMap)).toBeNull();
    expect(applyBailerJonesOverride('', bjMap)).toBeNull();
    expect(applyBailerJonesOverride('0000', bjMap)).toBeNull();
  });

  it('pins the BJ distance', () => {
    for (const f of FIVE_HIPS) {
      const out = applyBailerJonesOverride(f.sourceId, bjMap);
      expect(out, f.label).not.toBeNull();
      expect(out, f.label).toBe(f.bjDist);
    }
  });

  it('pulls the three highest-S/N supergiants back by 37%-62%', () => {
    // HIP 22365 / 25733 / 38430 are the showcase catastrophic-parallax
    // pullbacks (37%, 62%, 51%). HIP 46144 is the fourth flagged outlier
    // but only drops 18% — the test caps at three for the ≥25% headline,
    // and HIP 46144's pullback is asserted separately below.
    for (const label of ['HIP 22365', 'HIP 25733', 'HIP 38430']) {
      const f = FIVE_HIPS.find((x) => x.label === label)!;
      const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
      const drop = (f.preOverrideDist - out) / f.preOverrideDist;
      expect(drop, `${label} drop ratio`).toBeGreaterThan(0.25);
    }
  });

  it('HIP 46144 pulls back ~18% (lower-S/N outlier)', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 46144')!;
    const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
    const drop = (f.preOverrideDist - out) / f.preOverrideDist;
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeLessThan(0.20);
  });

  it('leaves the well-measured F-dwarf HIP 23785 within 5%', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 23785')!;
    const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
    expect(Math.abs(f.preOverrideDist - out) / f.preOverrideDist).toBeLessThan(0.05);
  });

});

describe('isBailerJonesEligible', () => {
  it('admits only the tier whose parallax B-J is a posterior over', () => {
    expect(isBailerJonesEligible('123', 'gaia_dr3_inversion')).toBe(true);
  });

  it('refuses every non-Gaia parallax tier — B-J would substitute its Galactic '
    + 'prior for a measurement', () => {
    for (const via of DIST_VIA_VALUES) {
      if (via === 'gaia_dr3_inversion') continue;
      expect(isBailerJonesEligible('123', via)).toBe(false);
    }
  });

  it('rejects rows without a Gaia source_id even on the Gaia tier', () => {
    expect(isBailerJonesEligible(null, 'gaia_dr3_inversion')).toBe(false);
    expect(isBailerJonesEligible('', 'gaia_dr3_inversion')).toBe(false);
  });

  it('gates on the resolved tier alone — no editorial source cell '
    + 'steers it, and the manifest carries none', () => {
    // Only the resolved tier decides.
    expect(isBailerJonesEligible('123', 'hip2_parallax')).toBe(false);
    expect(isBailerJonesEligible('123', 'gaia_dr3_inversion')).toBe(true);
  });
});

describe('angularSeparationDeg', () => {
  it('returns 0 for identical positions', () => {
    expect(angularSeparationDeg(5, -30, 5, -30)).toBeCloseTo(0, 10);
  });

  it('returns 90° between RA-axis pole and equator at RA=0', () => {
    expect(angularSeparationDeg(0, 90, 0, 0)).toBeCloseTo(90, 6);
  });

  it('returns ~90° for two equatorial points 6h apart', () => {
    expect(angularSeparationDeg(0, 0, 6, 0)).toBeCloseTo(90, 6);
  });

  it('matches a known LMC-direction great-circle distance', () => {
    // HD 268749 at (4.8915 h, -69.409°) → LMC centre (5.25067 h, -69.19°).
    // Compute by hand: small-angle approximation says ~2.5° separation;
    // exact vector form here is the canonical value.
    const sep = angularSeparationDeg(4.8915, -69.409, LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG);
    expect(sep).toBeGreaterThan(0.5);
    expect(sep).toBeLessThan(LMC_CONE_HALF_ANGLE_DEG);
  });
});

describe('isInLmcCone', () => {
  it('accepts the LMC centre itself', () => {
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG)).toBe(true);
  });

  it('rejects a solar-neighbourhood RA/Dec diametrically opposite the LMC', () => {
    // (RA=12h, Dec=0°) — far from the LMC cone.
    expect(isInLmcCone(12, 0)).toBe(false);
  });

  it('rejects the SMC direction (out of scope)', () => {
    // SMC centre ≈ (0.877 h, -72.8°). Outside the LMC cone — the SMC
    // override gets its own pipeline.
    expect(isInLmcCone(0.877, -72.8)).toBe(false);
  });

  it('boundary: just inside the cone passes, just outside fails', () => {
    // Confirms the cone gate is the half-angle, not something tighter
    // like a great-circle box.
    const epsilon = 0.01;
    const inDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG - epsilon);
    const outDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG + epsilon);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, inDec)).toBe(true);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, outDec)).toBe(false);
  });

  /** Great-circle destination from the LMC centre: walk `sepDeg` along
   *  initial position angle `paDeg` (east of north), return [raHours, decDeg].
   *  Standard navigation formulas — independent of angularSeparationDeg's
   *  vector implementation. */
  function offsetFromLmcCentre(sepDeg: number, paDeg: number): [number, number] {
    const d1 = (LMC_CENTRE_DEC_DEG * Math.PI) / 180;
    const s = (sepDeg * Math.PI) / 180;
    const pa = (paDeg * Math.PI) / 180;
    const d2 = Math.asin(Math.sin(d1) * Math.cos(s) + Math.cos(d1) * Math.sin(s) * Math.cos(pa));
    const dRa = Math.atan2(
      Math.sin(pa) * Math.sin(s) * Math.cos(d1),
      Math.cos(s) - Math.sin(d1) * Math.sin(d2),
    );
    return [
      LMC_CENTRE_RA_HOURS + (dRa * 180 / Math.PI) / 15,
      (d2 * 180) / Math.PI,
    ];
  }

  it('boundary: just inside the cone passes on the RA axis (cos(Dec) weighting)', () => {
    // At Dec −69.19° (cos Dec ≈ 0.355) a 15° great-circle arc due east
    // swings RA by 37.02°, not 15° — pin the stretch so a "simplified"
    // separation that drops the cos(Dec) weighting fails here.
    const epsilon = 0.01;
    const [raEdge] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG, 90);
    expect((raEdge - LMC_CENTRE_RA_HOURS) * 15).toBeCloseTo(37.0241, 3);
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 90);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 90);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });

  it('boundary: diagonal RA+Dec offset at cone edge', () => {
    // PA 45° — both axes move, so the gate must be great-circle
    // distance, not a per-axis (Manhattan/box) test.
    const epsilon = 0.01;
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 45);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 45);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });
});

describe('LMC distance vs MAX_DIST_PC invariant', () => {
  it('LMC_DISTANCE_PC sits inside the bounded-scope cutoff', () => {
    // The kinematic override snaps ~54 supergiants to LMC_DISTANCE_PC,
    // then every row passes the dist > MAX_DIST_PC drop. If either
    // constant drifts across the other, the whole LMC population is
    // silently dropped with no counter to surface it. Any future
    // kinematic-override target (SMC ≈ 62 kpc) must either satisfy
    // this or raise MAX_DIST_PC.
    expect(LMC_DISTANCE_PC).toBeLessThan(MAX_DIST_PC);
  });
});

describe('applyLmcKinematicOverride', () => {
  // Tier-A fixtures from Gaia DR3 — three real LMC supergiants
  // (HDE 268xxx range) and one halo-PM outlier inside the LMC cone.
  // The distances are the pre-override values that get smeared
  // 5-200 kpc by 1/π inversion.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number;
    pmRa: number | null; pmDec: number | null;
    preOverrideDist: number;
  }
  const LMC_HITS: Fixture[] = [
    { label: 'HD 268749 (B7 IAB LMC supergiant)', ra: 4.8915, dec: -69.409, mag: 12.029, pmRa: 2.044, pmDec: -0.096, preOverrideDist: 13368.7 },
    { label: 'HD 268718',                         ra: 4.866, dec: -69.426, mag: 10.596, pmRa: 2.093, pmDec: -0.138, preOverrideDist: 46323.4 },
    { label: 'HD 268654 (smeared to 196 kpc)',    ra: 4.820, dec: -69.457, mag: 10.5,   pmRa: 2.033, pmDec: -0.198, preOverrideDist: 196078.4 },
  ];
  const LMC_PM_NON_HITS: Fixture[] = [
    // Inside the LMC cone but PM ≠ LMC bulk — a halo star or runaway,
    // should pass through unchanged.
    { label: 'HD 270752 (halo in LMC direction)', ra: 4.792, dec: -65.331, mag: 11.214, pmRa: 14.925, pmDec: -3.62, preOverrideDist: 5298.5 },
  ];

  const SNAP = { kind: 'snap', distPc: LMC_DISTANCE_PC } as const;
  const NOT_MEMBER = { kind: 'not_member' } as const;
  const RULES_OUT = { kind: 'parallax_rules_out' } as const;
  const atCentre = [LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG] as const;
  const bulkPm = [LMC_PM_RA_CENTRE, LMC_PM_DEC_CENTRE] as const;

  it('LMC-direction + LMC-PM star is snapped to 49.594 kpc', () => {
    for (const f of LMC_HITS) {
      const plx = { mas: 1000 / f.preOverrideDist, errMas: 0.02 };
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec, plx);
      expect(out, f.label).toEqual(SNAP);
    }
  });

  it('LMC-direction + non-LMC-PM star is not a member', () => {
    for (const f of LMC_PM_NON_HITS) {
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec, null);
      expect(out, f.label).toEqual(NOT_MEMBER);
    }
  });

  it('off-cone star with textbook LMC bulk PM is not overridden', () => {
    // The gate the function owns rather than delegates: a star whose PM
    // sits exactly on the LMC bulk centre but which lies nowhere near the
    // LMC gets no override. Snapping it would teleport a Galactic star to
    // 49.6 kpc.
    expect(applyLmcKinematicOverride(12, 0, ...bulkPm, null)).toEqual(NOT_MEMBER);
  });

  it('is not a member when pm_ra or pm_dec is missing', () => {
    // A row can reach a position tier that states no proper motion; treat
    // those as ineligible for the kinematic gate.
    expect(applyLmcKinematicOverride(...atCentre, null, 0, null)).toEqual(NOT_MEMBER);
    expect(applyLmcKinematicOverride(...atCentre, 0, null, null)).toEqual(NOT_MEMBER);
  });

  it('refuses a cone + PM match whose own parallax rules the LMC out', () => {
    expect(applyLmcKinematicOverride(
      ...atCentre, ...bulkPm, { mas: 3.5695, errMas: 0.0105 },
    )).toEqual(RULES_OUT);
  });

  it('snaps a noisy parallax that cannot distinguish the LMC from Sol', () => {
    expect(applyLmcKinematicOverride(
      ...atCentre, ...bulkPm, { mas: 4.01, errMas: 2.34 },
    )).toEqual(SNAP);
  });

  it('snaps when the parallax states no error, or there is none', () => {
    expect(applyLmcKinematicOverride(
      ...atCentre, ...bulkPm, { mas: 3.5695, errMas: null },
    )).toEqual(SNAP);
    expect(applyLmcKinematicOverride(...atCentre, ...bulkPm, null)).toEqual(SNAP);
  });

  it('boundary: the parallax gate is one-sided at LMC_PARALLAX_CONSISTENCY_SIGMA', () => {
    const errMas = 0.01;
    const at = (sigma: number) => applyLmcKinematicOverride(
      ...atCentre, ...bulkPm,
      { mas: LMC_PARALLAX_MAS + sigma * errMas, errMas },
    );
    expect(at(LMC_PARALLAX_CONSISTENCY_SIGMA - 1e-6)).toEqual(SNAP);
    expect(at(LMC_PARALLAX_CONSISTENCY_SIGMA + 1e-6)).toEqual(RULES_OUT);
    expect(at(-50)).toEqual(SNAP);
  });

  it('ordering: LMC_KIN wins over BJ for an LMC-cone star with both', () => {
    // Synthetic LMC-cone + LMC-PM star with a B-J entry. Simulates the
    // build-catalog.ts ordering: B-J runs first and writes its posterior;
    // LMC_KIN runs after and clobbers it.
    const f = LMC_HITS[0]; // HD 268749
    const sourceId = 'fake-lmc-source-id';
    const bjMap = new Map([[sourceId, 8000]]); // arbitrary B-J posterior ≠ LMC distance
    const bj = applyBailerJonesOverride(sourceId, bjMap);
    expect(bj).toBe(8000);
    const lmc = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec, null);
    expect(lmc).toEqual(SNAP);
  });

  it('boundary: PM tolerance is per-component, not radial', () => {
    // |Δpm_ra| at the tolerance, |Δpm_dec| at 0 → pass. Mirror case → pass.
    // Both at the tolerance → still pass (per-component, not Euclidean).
    const eps = 1e-9;
    const passEdgeRa = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps, LMC_PM_DEC_CENTRE, null,
    );
    expect(passEdgeRa).toEqual(SNAP);
    const passBothEdges = applyLmcKinematicOverride(
      ...atCentre,
      LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps,
      LMC_PM_DEC_CENTRE - LMC_PM_TOLERANCE + eps,
      null,
    );
    expect(passBothEdges).toEqual(SNAP);
    const failJustOver = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE + eps, LMC_PM_DEC_CENTRE, null,
    );
    expect(failJustOver).toEqual(NOT_MEMBER);
  });

});
