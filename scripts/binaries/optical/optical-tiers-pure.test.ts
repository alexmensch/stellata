import { describe, expect, it } from 'vitest';
import { AU_PER_PC } from '../../../src/astro-core/astronomy-constants';
import { hip2AstrometryRow } from '../../catalog/sources/hip2-fixture';
import { wdsPair } from '../../wds/wds-fixture';
import type { WdsPair } from '../../wds/wds-pure';
import { UNRESOLVED_ASTROMETRY, type ComponentAstrometry, type MeasuredAstrometry } from '../astrometry/routes-pure';
import type { Parallax } from '../astrometry/system-anchors-pure';
import type { GaiaAstrometryCatalogRow } from '../../catalog/sources/gaia-astrometry-source';
import { gaiaAstrometryRow } from '../load/load-fixture';
import { UNKNOWN_COMPONENT_MASS_MSUN } from '../masses/pair-masses';
import type { OrbitVia } from '../multiples-record-pure';
import { NO_ORBIT, type PairOrbit } from '../orbits/select-orbit-pure';
import type { OrbitElements } from '../orbits/nss-elements-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed, indices } from '../resolve/resolve-fixture';
import {
  bothGaiaVerdict, CIRCULAR_KM_S_1AU_1MSUN, classifyPairOptical, cpmBaselineVerdict, escapeVelocityKmS, OPTICAL_REJECT_VIA,
  pairBeyondSeparationLimit, separationAu, separationExceedsLimit, transverseVelocityKmS, type PairContext,
} from './optical-tiers-pure';
import { orbitalPmBudgetKmS } from './pm-budget-pure';

const DEFAULT_TOTAL_MASS = 2 * UNKNOWN_COMPONENT_MASS_MSUN;
const plx = (parallaxMas: number, parallaxErrorMas: number | null): Parallax => ({ parallaxMas, parallaxErrorMas });
const gaiaRow = (sourceId: string, over: Partial<GaiaAstrometryCatalogRow>): GaiaAstrometryCatalogRow => gaiaAstrometryRow({ sourceId, ...over });
const measured = (over: Partial<MeasuredAstrometry> = {}): MeasuredAstrometry => ({
  astrometryVia: 'gaia_5p', raDeg: 100, decDeg: 0, parallaxMas: 10, parallaxErrorMas: 0.05, pmraMasyr: 4100, pmdecMasyr: -3200, refEpoch: 2016,
  ...over,
});

interface Case {
  notes?: string;
  primaryGaia?: string | null;
  secondaryGaia?: string | null;
  primaryHip?: number | null;
  secondaryHip?: number | null;
  rows?: readonly GaiaAstrometryCatalogRow[];
  hip2?: readonly (readonly [number, number])[];
  magPri?: number | null;
  magSec?: number | null;
  orbitVia?: OrbitVia;
  rhoLast?: number | null;
  pair?: WdsPair;
  systemParallax?: Parallax | null;
  totalMassMsun?: number;
  budget?: number;
  primaryAst?: ComponentAstrometry;
  secondaryAst?: ComponentAstrometry;
  systemPm?: PairContext['systemPm'];
}

function classify(c: Case = {}) {
  const pair = c.pair ?? wdsPair({ notes: c.notes ?? '    ', magPri: c.magPri ?? null, magSec: c.magSec ?? null, rhoLast: c.rhoLast === undefined ? 5.0 : c.rhoLast });
  const side = (gaia: string | null | undefined, hip: number | null | undefined) => ({
    gaiaSourceId: gaia ?? null, hip: hip ?? null, resolveVia: gaia ? 'orb6_hip' as const : 'unresolved' as const,
  });
  const p = decomposed(pair, { primary: side(c.primaryGaia, c.primaryHip), secondary: side(c.secondaryGaia, c.secondaryHip) });
  const ix = indices({
    srcToAstrometry: new Map((c.rows ?? []).map((r) => [r.ref.row, r])),
    hip2: new Map((c.hip2 ?? []).map(([hip, plxMas]) => [hip, hip2AstrometryRow({ plxMas })])),
  });
  return classifyPairOptical(p, {
    orbitVia: c.orbitVia ?? 'none',
    astrometry: { primary: c.primaryAst ?? UNRESOLVED_ASTROMETRY, secondary: c.secondaryAst ?? UNRESOLVED_ASTROMETRY },
    systemParallax: c.systemParallax ?? null,
    systemPm: c.systemPm ?? null,
    totalMassMsun: c.totalMassMsun ?? DEFAULT_TOTAL_MASS,
    orbitalPmBudgetKmS: c.budget ?? 0,
  }, ix);
}

describe('classifyPairOptical: WDS notes', () => {
  it('keeps on T / V / Z, rejects on S / U / X / Y, and a reject char wins', () => {
    expect(classify({ notes: 'V   ' })).toBe('wds_notes_kept');
    expect(classify({ notes: 'U   ' })).toBe('wds_notes_rejected');
    expect(classify({ notes: 'VU  ' })).toBe('wds_notes_rejected');
  });
});

describe('classifyPairOptical: both Gaia', () => {
  const both = (p: Partial<GaiaAstrometryCatalogRow>, s: Partial<GaiaAstrometryCatalogRow>, rest: Case = {}) =>
    classify({ primaryGaia: '1', secondaryGaia: '2', rows: [gaiaRow('1', p), gaiaRow('2', s)], ...rest });

  it('keeps concordant parallax and proper motion', () => {
    expect(both({ parallaxMas: 10.0, parallaxErrorMas: 0.05, pmraMasyr: 10.0, pmdecMasyr: -5.0 },
      { parallaxMas: 10.01, parallaxErrorMas: 0.05, pmraMasyr: 10.1, pmdecMasyr: -4.9 })).toBe('gaia_kept');
  });

  it('sends a within-limit 3σ parallax disagreement to the escape gate, which keeps a matching PM', () => {
    expect(both({ parallaxMas: 10.0, parallaxErrorMas: 0.001 }, { parallaxMas: 10.05, parallaxErrorMas: 0.001 })).toBe('gaia_kept');
  });

  it('rejects a beyond-limit disagreement (reachable only below tier 3\'s poe floor)', () => {
    expect(bothGaiaVerdict(gaiaRow('1', { parallaxMas: 10.0, parallaxErrorMas: 0.001 }), gaiaRow('2', { parallaxMas: 5.0, parallaxErrorMas: 0.001 }), null, 6.0, 0))
      .toBe('rejected');
  });

  it('rejects a transverse velocity far past escape, keeps an orbital PM split inside it', () => {
    const at = (pmra: number) => both({ parallaxMas: 10.0, parallaxErrorMas: 0.05, pmraMasyr: 0, pmdecMasyr: 0 }, { parallaxMas: 10.0, parallaxErrorMas: 0.05, pmraMasyr: pmra, pmdecMasyr: 0 });
    expect(at(200.0)).toBe('gaia_rejected');
    expect(at(10.0)).toBe('gaia_kept');
  });

  it('raises the reject threshold by the orbital-PM budget (22039-2451 AC)', () => {
    const ac = (budget: number) => both({ parallaxMas: 10.0, parallaxErrorMas: 0.01, pmraMasyr: 0, pmdecMasyr: 0 },
      { parallaxMas: 10.0, parallaxErrorMas: 0.01, pmraMasyr: 30.0, pmdecMasyr: 0 }, { budget });
    expect(ac(0)).toBe('gaia_rejected');
    expect(ac(5.0)).toBe('gaia_kept');
  });

  it('withholds the budget from a pair not positively collocated (AR Cas AF / AG)', () => {
    expect(both({ parallaxMas: 4.9, parallaxErrorMas: 0.03, pmraMasyr: 0, pmdecMasyr: 0 },
      { parallaxMas: 4.9, parallaxErrorMas: 0.03, pmraMasyr: 3.6, pmdecMasyr: 0 }, { rhoLast: 67.0, totalMassMsun: 9.9, budget: 10.0 }))
      .toBe('gaia_rejected');
  });

  it('lets an orbit on file override a both-Gaia disagreement', () => {
    expect(both({ parallaxMas: 10.0, parallaxErrorMas: 0.001 }, { parallaxMas: 10.05, parallaxErrorMas: 0.001 }, { orbitVia: 'orb6' })).toBe('orbit_kept');
  });
});

describe('classifyPairOptical: separation limit', () => {
  const pollux = gaiaRow('2', { parallaxMas: 3.36, parallaxErrorMas: 0.31 });

  it('rejects a well-measured companion far from the system anchor (Pollux F)', () => {
    expect(classify({ secondaryGaia: '2', rows: [pollux], rhoLast: 57.3, systemParallax: plx(96.5, 0.3) })).toBe('sep_limit_rejected');
  });

  it('is silent for a concordant companion, without an anchor, and below the poe floor', () => {
    const mags = { magPri: 4.0, magSec: 6.0 };
    expect(classify({ secondaryGaia: '2', rows: [gaiaRow('2', { parallaxMas: 100.5, parallaxErrorMas: 0.05 })], systemParallax: plx(100.0, 0.05), ...mags }))
      .toBe('mag_heuristic_kept');
    expect(classify({ secondaryGaia: '2', rows: [pollux], ...mags })).toBe('mag_heuristic_kept');
    expect(classify({ secondaryGaia: '2', rows: [gaiaRow('2', { parallaxMas: 3.36, parallaxErrorMas: 1.0 })], systemParallax: plx(100.0, 0.05), ...mags }))
      .toBe('mag_heuristic_kept');
  });

  it('yields to an orbit on file', () => {
    expect(classify({ secondaryGaia: '2', rows: [pollux], orbitVia: 'orb6', rhoLast: 57.3, systemParallax: plx(96.5, 0.3) })).toBe('orbit_kept');
  });
});

describe('classifyPairOptical: orbit and magnitude gap', () => {
  it('keeps a magnitude gap of 5 or less, rejects a wider one, keeps a pair with no magnitudes', () => {
    expect(classify({ magPri: 4.0, magSec: 6.0 })).toBe('mag_heuristic_kept');
    expect(classify({ magPri: 2.0, magSec: 10.0 })).toBe('mag_heuristic_rejected');
    expect(classify()).toBe('mag_heuristic_kept');
  });

  it('lets an orbit on file override the gap (Sirius A-B) and the absence of data', () => {
    expect(classify({ magPri: -1.47, magSec: 8.44, orbitVia: 'orb6' })).toBe('orbit_kept');
    expect(classify({ orbitVia: 'gaia_nss' })).toBe('orbit_kept');
  });
});

describe('classifyPairOptical: asymmetric Gaia + HIP2', () => {
  it('rejects a kpc split off a poorly measured Gaia parallax (Sirius A-C)', () => {
    expect(classify({ primaryHip: 32349, secondaryGaia: '2', rows: [gaiaRow('2', { parallaxMas: 0.5, parallaxErrorMas: 0.15 })], hip2: [[32349, 378.0]] }))
      .toBe('asymm_rejected');
  });

  it('keeps a concordant pair, whichever side is saturated', () => {
    const row = (id: string) => gaiaRow(id, { parallaxMas: 10.0, parallaxErrorMas: 0.1 });
    expect(classify({ primaryHip: 1, secondaryGaia: '2', rows: [row('2')], hip2: [[1, 10.01]] })).toBe('asymm_kept');
    expect(classify({ primaryGaia: '1', secondaryHip: 2, rows: [row('1')], hip2: [[2, 10.01]] })).toBe('asymm_kept');
  });

  it('keeps a 3σ HIP2-vs-Gaia offset worth under 1 pc (AU Mic)', () => {
    expect(classify({ primaryHip: 5, secondaryGaia: '2', rows: [gaiaRow('2', { parallaxMas: 103.1, parallaxErrorMas: 0.02 })], hip2: [[5, 94.3]] }))
      .toBe('asymm_kept');
  });
});

describe('separation geometry', () => {
  it('counts only the projected term when the depth gap is insignificant', () => {
    expect(separationAu(plx(10.0, 0.05), plx(10.0, 0.05), 5.0)).toBeCloseTo(500.0, 3);
    expect(separationAu(plx(10.0, 5.0), plx(9.0, 5.0), 1.0)).toBeCloseTo(100.0, 3);
  });

  it('counts the radial gap when significant (Pollux F)', () => {
    expect(separationAu(plx(96.5, 0.3), plx(3.36, 0.31), 57.3) / AU_PER_PC).toBeGreaterThan(280.0);
    expect(separationExceedsLimit(plx(96.5, 0.3), plx(3.36, 0.31), 57.3)).toBe(true);
  });

  it('keeps a 0.9 pc gap inside the limit, a missing σ read as zero', () => {
    expect(separationExceedsLimit(plx(94.3, null), plx(103.1, 0.02), 5.0)).toBe(false);
  });
});

describe('cpmBaselineVerdict (61 Cyg: 5.2″/yr over a century)', () => {
  const cpm = (over: Partial<WdsPair> = {}) => wdsPair({
    dateFirst: 1900, thetaFirst: 90.0, rhoFirst: 5.0, dateLast: 2000, thetaLast: 90.0, rhoLast: 5.0, magPri: 4.0, magSec: 6.0, ...over,
  });
  const PM = [4100.0, -3200.0] as const;

  it('keeps static geometry, rejects drift tracking the slip, by ρ or by PA alone', () => {
    expect(cpmBaselineVerdict(cpm(), ...PM)).toBe('kept');
    expect(cpmBaselineVerdict(cpm({ rhoLast: 300.0 }), ...PM)).toBe('rejected');
    expect(cpmBaselineVerdict(cpm({ rhoFirst: 200.0, rhoLast: 200.0, thetaLast: 180.0 }), ...PM)).toBe('rejected');
  });

  it('is silent between the floor and half the slip, for a slow primary, missing data, and a zero baseline', () => {
    expect(cpmBaselineVerdict(cpm({ rhoLast: 105.0 }), ...PM)).toBeNull();
    expect(cpmBaselineVerdict(cpm({ rhoLast: 300.0 }), 50.0, 0.0)).toBeNull();
    expect(cpmBaselineVerdict(cpm({ rhoFirst: null }), ...PM)).toBeNull();
    expect(cpmBaselineVerdict(cpm(), null, -3200.0)).toBeNull();
    expect(cpmBaselineVerdict(cpm({ dateFirst: 2000, dateLast: 2000, rhoLast: 300.0 }), ...PM)).toBeNull();
  });

  describe('as the cascade\'s tier', () => {
    const pair = (over: Partial<WdsPair> = {}) => cpm({ rhoLast: 300.0, ...over });
    const inherited = (via: 'unresolved' | 'athyg_position' | 'gaia_5p'): ComponentAstrometry =>
      via === 'unresolved' ? UNRESOLVED_ASTROMETRY : measured({ astrometryVia: via, parallaxMas: null, parallaxErrorMas: null, pmraMasyr: null, pmdecMasyr: null });

    it('engages for a secondary with no parallax of its own', () => {
      expect(classify({ pair: pair(), primaryAst: measured(), secondaryAst: inherited('unresolved') })).toBe('cpm_baseline_rejected');
      expect(classify({ pair: pair({ rhoLast: 5.0 }), primaryAst: measured(), secondaryAst: inherited('unresolved') })).toBe('cpm_baseline_kept');
      expect(classify({ pair: pair(), primaryAst: measured(), secondaryAst: inherited('athyg_position') })).toBe('cpm_baseline_rejected');
    });

    it('is silent for a secondary with its own route, and with no primary PM', () => {
      expect(classify({ pair: pair(), primaryAst: measured(), secondaryAst: inherited('gaia_5p') })).toBe('mag_heuristic_kept');
      expect(classify({ pair: pair(), secondaryAst: inherited('unresolved') })).toBe('mag_heuristic_kept');
    });

    it('lets a PM-less primary borrow the system PM anchor', () => {
      expect(classify({ pair: pair(), secondaryAst: inherited('unresolved'), systemPm: { pmraMasyr: 4100.0, pmdecMasyr: -3200.0 } }))
        .toBe('cpm_baseline_rejected');
    });
  });
});

describe('pairBeyondSeparationLimit', () => {
  const ANCHOR = plx(96.5, 0.3);
  const run = (rows: readonly GaiaAstrometryCatalogRow[], p: string | null, s: string | null, anchor: Parallax | null, rho: number) => {
    const pair = decomposed(wdsPair(), { primary: { gaiaSourceId: p, resolveVia: 'orb6_hip' }, secondary: { gaiaSourceId: s, resolveVia: 'orb6_hip' } });
    return pairBeyondSeparationLimit(pair.primary, pair.secondary, anchor, rho, indices({ srcToAstrometry: new Map(rows.map((r) => [r.ref.row, r])) }));
  };

  it('splits a companion from the anchor its partner inherits (Pollux F)', () => {
    expect(run([gaiaRow('2', { parallaxMas: 3.36, parallaxErrorMas: 0.31 })], null, '2', ANCHOR, 57.3)).toBe(true);
  });

  it('keeps an inner binary sharing one source, compared side to side and not to the anchor', () => {
    expect(run([gaiaRow('9', { parallaxMas: 4.36, parallaxErrorMas: 0.02 })], '9', '9', plx(7.32, 0.02), 0.0)).toBe(false);
  });

  it('keeps a concordant pair, a low-poe parallax, and a pair with no parallax', () => {
    expect(run([gaiaRow('2', { parallaxMas: 100.5, parallaxErrorMas: 0.05 })], null, '2', plx(100.0, 0.05), 5.0)).toBe(false);
    expect(run([gaiaRow('2', { parallaxMas: 3.36, parallaxErrorMas: 1.0 })], null, '2', ANCHOR, 57.3)).toBe(false);
    expect(run([], null, null, ANCHOR, 57.3)).toBe(false);
  });
});

describe('escape and transverse velocity', () => {
  it('escapes 1 M☉ at 1 AU at ~42.1 km/s, and is null at zero separation', () => {
    expect(escapeVelocityKmS(1.0, 1.0)).toBeCloseTo(42.12, 1);
    expect(escapeVelocityKmS(1.0, 0.0)).toBeNull();
  });

  it('moves 100 mas/yr at 5.95 pc at ~2.82 km/s', () => {
    expect(transverseVelocityKmS(100.0, 5.95)).toBeCloseTo(2.82, 2);
  });
});

describe('orbitalPmBudgetKmS', () => {
  const W = '22039-2451';
  const ac = decomposed(wdsPair({ wdsId: W, components: 'AC', rhoLast: 28.0 }));
  const ab = decomposed(wdsPair({ wdsId: W, components: 'AB', rhoLast: 3.4 }));
  const aaAb = decomposed(wdsPair({ wdsId: W, components: 'Aa,Ab', rhoLast: 0.0 }));
  const spectroscopic: OrbitElements = {
    pDays: 6.066, tJd: null, e: null, aAu: 0.08, iRad: null, periastronRad: null, nodeRad: null, q: null, distancePc: null,
  };
  const orbits = new Map<DecomposedPair, PairOrbit>([[ac, NO_ORBIT], [ab, NO_ORBIT], [aaAb, { orbitVia: 'msc', elements: spectroscopic }]]);
  const masses = new Map([[ac, 1.2], [ab, 1.6], [aaAb, 1.5]]);
  const ANCHOR_PLX = 21.2;

  it('sums the tighter sub-pairs the components host, a sub-pair Gaia averages out contributing nothing', () => {
    const expected = CIRCULAR_KM_S_1AU_1MSUN * Math.sqrt(1.6 / (3.4 * (1000.0 / ANCHOR_PLX)));
    expect(orbitalPmBudgetKmS(ac, [ac, ab, aaAb], orbits, masses, ANCHOR_PLX)).toBeCloseTo(expected, 6);
  });

  it('gives a pair with no measured ρ no budget', () => {
    expect(orbitalPmBudgetKmS(aaAb, [ac, ab, aaAb], orbits, masses, ANCHOR_PLX)).toBe(0.0);
  });

  it('ignores unrelated and wider pairs', () => {
    const acW = decomposed(wdsPair({ wdsId: 'W-1', components: 'AC', rhoLast: 28.0 }));
    const bd = decomposed(wdsPair({ wdsId: 'W-1', components: 'BD', rhoLast: 3.0 }));
    const de = decomposed(wdsPair({ wdsId: 'W-1', components: 'DE', rhoLast: 90.0 }));
    const none = new Map<DecomposedPair, PairOrbit>([acW, bd, de].map((p) => [p, NO_ORBIT]));
    const m = new Map([acW, bd, de].map((p) => [p, DEFAULT_TOTAL_MASS]));
    expect(orbitalPmBudgetKmS(acW, [acW, bd, de], none, m, ANCHOR_PLX)).toBe(0.0);
  });
});

describe('OPTICAL_REJECT_VIA', () => {
  it('is every rejecting tag, in cascade order', () => {
    expect(OPTICAL_REJECT_VIA).toEqual([
      'wds_notes_rejected', 'sep_limit_rejected', 'gaia_rejected', 'asymm_rejected', 'cpm_baseline_rejected', 'mag_heuristic_rejected',
    ]);
  });
});
