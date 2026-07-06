import { describe, it, expect } from 'vitest';
import {
  buildCatalogRowIndexMap,
  canonicalCompLetter,
  composeSyntheticId,
  groupBySystem,
  hasRenderableOrbit,
  imputeCompanionAbsmag,
  imputeCompanionCi,
  parentComponentToken,
  parseMultiplesTsv,
  projectFromSepPa,
  promoteCompanions,
  stampComponentLetters,
  stripDoubledParentToken,
  wingRenderablePrimaries,
  type MultiplesTsvRow,
} from './companion-promotion';
import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  FLAG_BINARY_PRIMARY,
  FLAG_HAS_NAME,
  SOLAR_BV_FALLBACK,
  SPECTRAL_UNKNOWN,
  classifyFromSimbad,
} from './catalog-pure';
import { CONSTELLATIONS } from './constellations';
import { R_V, avSolToStar, type DustGrid } from './dust-deextinction-pure';
import type { Star } from './stars-parse';

function makeStar(overrides: Partial<Star> = {}): Star {
  return {
    x: 0, y: 0, z: 0,
    absmag: 5.0,
    ci: 0.65,
    spectClass: 4,
    lumClass: 2,
    physicalRadius: 1.0,
    conIndex: 255,
    flags: 0,
    proper: null,
    bayer: null,
    hip: null, hd: null, hr: null, flam: null, gl: null,
    gaiaSourceId: null,
    spectDisplay: null,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    varType: 0,
    athygDist: null,
    athygDistSrc: null,
    syntheticId: null,
    ...overrides,
  };
}

export function multiplesRow(overrides: Partial<MultiplesTsvRow> = {}): MultiplesTsvRow {
  return {
    systemId: 'WDS-1-AB',
    comp: 'B',
    hip: null,
    gaiaSourceId: null,
    x_pc: 100, y_pc: 0, z_pc: 0,
    absmag: 5.0, ci: 0.6, spect: '',
    name: '',
    source: 'wds',
    astrometryVia: 'gaia_5p',
    spectVia: 'none',
    photometryVia: 'athyg_own',
    orbitRole: 'secondary',
    distPc: 100,
    pDays: null,
    tJd: null,
    e: null,
    aAU: null,
    iRad: null,
    omegaRad: null,
    q: null,
    sepArcsec: null,
    paDeg: null,
    sepPaEpochJd: null,
    dmag: null,
    ...overrides,
  };
}

/** Complete Tier-1 element set — hasRenderableOrbit(row) === true. */
const ORBIT_ELEMENTS = {
  pDays: 680.168, tJd: 2446927.22, e: 0.227, aAU: 2.576,
  iRad: 1.46, omegaRad: 5.41, q: 0.5,
} as const;

describe('parseMultiplesTsv', () => {
  it('parses a minimal header + one row', () => {
    const header = [
      'system_id','comp','hip','gaia_source_id',
      'x_pc','y_pc','z_pc','absmag','ci','spect','name',
      'source','regime','resolve_via','astrometry_via','orbit_via',
      'spect_via','photometry_via','orbit_role',
      'P_days','T_jd','e','a_AU','i_rad','omega_rad','Omega_rad',
      'q','dist_pc',
      'sep_arcsec','pa_deg','sep_pa_epoch_jd','dmag',
    ].join('\t');
    const body = [
      'WDS-X-AB','A','12345','1234567890123456',
      '1.0','2.0','3.0','5.50','0.45','G2V','Sirius',
      'athyg','2','orb6_hip','gaia_5p','orb6',
      'simbad','athyg_own','primary',
      '365.25','2451545.0','0.1','1.0','0.5','0.6','0.7',
      '0.5','10.0',
      '7.123','265.45','2458850.0','0.85',
    ].join('\t');
    const rows = parseMultiplesTsv(`${header}\n${body}\n`);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.systemId).toBe('WDS-X-AB');
    expect(r.comp).toBe('A');
    expect(r.hip).toBe(12345);
    expect(r.gaiaSourceId).toBe('1234567890123456');
    expect(r.x_pc).toBe(1.0);
    expect(r.absmag).toBe(5.5);
    expect(r.spect).toBe('G2V');
    expect(r.photometryVia).toBe('athyg_own');
    expect(r.orbitRole).toBe('primary');
    expect(r.sepArcsec).toBe(7.123);
    expect(r.paDeg).toBe(265.45);
    expect(r.dmag).toBe(0.85);
  });

  it('treats blank cells as null', () => {
    const header = [
      'system_id','comp','hip','gaia_source_id',
      'x_pc','y_pc','z_pc','absmag','ci','spect','name',
      'source','regime','resolve_via','astrometry_via','orbit_via',
      'spect_via','photometry_via','orbit_role',
      'P_days','T_jd','e','a_AU','i_rad','omega_rad','Omega_rad',
      'q','dist_pc',
      'sep_arcsec','pa_deg','sep_pa_epoch_jd','dmag',
    ].join('\t');
    const body = [
      'WDS-X-AB','B','','',
      '','','','','','','',
      'wds','0','unresolved','unresolved','none',
      'none','none','secondary',
      '','','','','','','',
      '','',
      '','','','',
    ].join('\t');
    const rows = parseMultiplesTsv(`${header}\n${body}\n`);
    expect(rows[0].hip).toBeNull();
    expect(rows[0].gaiaSourceId).toBeNull();
    expect(rows[0].x_pc).toBeNull();
    expect(rows[0].absmag).toBeNull();
    expect(rows[0].dmag).toBeNull();
  });

  it('throws when a required column is missing from the header', () => {
    const header = 'system_id\tcomp';
    expect(() => parseMultiplesTsv(header)).toThrowError(/missing required column/);
  });
});

describe('projectFromSepPa', () => {
  it('places the companion at the primary plus tangent-plane offset', () => {
    // Primary at 100 pc due RA=0, Dec=0 → xyz = (100, 0, 0).
    // sep=3600″ = 1° at 100 pc → 1.745 pc tangent offset.
    // PA=0 → due north (along +Z).
    const p = projectFromSepPa(100, 0, 0, 3600, 0);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.z).toBeCloseTo(100 * Math.PI / 180, 5);
  });

  it('PA=90 sends the companion due east (+RA, +Y at the equator)', () => {
    const p = projectFromSepPa(100, 0, 0, 3600, 90);
    if (!p) return;
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(100 * Math.PI / 180, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it('returns null when the primary is at the origin', () => {
    expect(projectFromSepPa(0, 0, 0, 10, 0)).toBeNull();
  });

  it('preserves distance to within ~the small-angle correction', () => {
    // 1° offset at any distance: companion distance differs from primary
    // distance by sec(1°)-1 ≈ 1.52e-4 — well under 1%.
    const primaryDist = 100;
    const p = projectFromSepPa(primaryDist, 0, 0, 3600, 45);
    if (!p) return;
    expect(p.distPc / primaryDist - 1).toBeLessThan(1e-3);
  });
});

describe('imputeCompanionAbsmag', () => {
  const primary = multiplesRow({ orbitRole: 'primary', comp: 'A', absmag: 1.45 });

  it('imputes from primary + Δmag when stage 6 tagged photometry as inherited', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: 1.45, dmag: 9.91,
      photometryVia: 'athyg_system_inherited',
    });
    const r = imputeCompanionAbsmag(sec, primary, SPECTRAL_UNKNOWN);
    expect(r?.absmag).toBeCloseTo(11.36, 4);
    expect(r?.source).toBe('dmag_imputed');
  });

  it('uses the secondary own absmag when photometry is its own', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: 11.18, dmag: 9.7,
      photometryVia: 'athyg_own',
    });
    const r = imputeCompanionAbsmag(sec, primary, SPECTRAL_UNKNOWN);
    expect(r?.absmag).toBe(11.18);
    expect(r?.source).toBe('own');
  });

  it('falls through to primary + Δmag when secondary absmag is null', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: null, dmag: 9.91,
      photometryVia: 'none',
    });
    const r = imputeCompanionAbsmag(sec, primary, SPECTRAL_UNKNOWN);
    expect(r?.absmag).toBeCloseTo(11.36, 4);
    expect(r?.source).toBe('dmag_imputed');
  });

  it('returns null when no path can produce an absmag', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: null, dmag: null,
      photometryVia: 'none',
    });
    expect(imputeCompanionAbsmag(sec, primary, SPECTRAL_UNKNOWN)).toBeNull();
  });

  it('derives M_V from a curated per-component type when photometry is inherited and Δmag missing (Algol Aa2)', () => {
    const sec = multiplesRow({
      comp: '2', absmag: -0.112, dmag: null,
      photometryVia: 'athyg_system_inherited',
      spectVia: 'curated', spect: 'K0IV',
      ...ORBIT_ELEMENTS,
    });
    const info = classifyFromSimbad('K0IV')!;
    const r = imputeCompanionAbsmag(sec, primary, info);
    expect(r?.source).toBe('spectral');
    // K0IV = midpoint of K0V (5.9) and K0III (0.7).
    expect(r?.absmag).toBeCloseTo(3.3, 4);
  });

  it('never lets the inherited absmag win over the spectral branch', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: -5.47, dmag: null,
      photometryVia: 'athyg_system_inherited',
      spectVia: 'simbad', spect: 'M3V',
    });
    const info = classifyFromSimbad('M3V')!;
    const r = imputeCompanionAbsmag(sec, primary, info);
    expect(r?.source).toBe('spectral');
    expect(r!.absmag).toBeGreaterThan(9);
  });

  it('keeps the inherited twin ONLY for orbital pairs with no per-component type', () => {
    const sec = multiplesRow({
      comp: '2', absmag: -0.112, dmag: null,
      photometryVia: 'athyg_system_inherited',
      spectVia: 'athyg', spect: 'B8V',
      ...ORBIT_ELEMENTS,
    });
    const r = imputeCompanionAbsmag(sec, primary, classifyFromSimbad('B8V')!);
    expect(r?.source).toBe('inherited_twin');
    expect(r?.absmag).toBe(-0.112);
  });

  it('drops the invented twin when the pair has no renderable orbit', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: -5.47, dmag: null,
      photometryVia: 'athyg_system_inherited',
      spectVia: 'athyg', spect: 'M2Ia',
    });
    expect(
      imputeCompanionAbsmag(sec, primary, classifyFromSimbad('M2Ia')!),
    ).toBeNull();
  });

  it('inherited spect (athyg) never routes through the spectral branch', () => {
    // The M2Ia string is the PRIMARY's class; deriving M_V from it
    // would re-mint the twin through the calibration table.
    const sec = multiplesRow({
      comp: 'B', absmag: null, dmag: null,
      photometryVia: 'none',
      spectVia: 'athyg', spect: 'M2Ia',
    });
    expect(
      imputeCompanionAbsmag(sec, primary, classifyFromSimbad('M2Ia')!),
    ).toBeNull();
  });

  it('pair-row-primary escape falls back to the anchor absmag, not anchor + sub-pair Δmag (40 Eri B)', () => {
    const keidB = multiplesRow({
      comp: 'B', absmag: null, dmag: 1.64,
      photometryVia: 'none', spectVia: 'simbad', spect: 'DA2.9',
    });
    const r = imputeCompanionAbsmag(keidB, primary, classifyFromSimbad('DA2.9')!, false);
    expect(r?.source).toBe('anchor_collocated');
    expect(r?.absmag).toBe(1.45);
    const asSecondary = imputeCompanionAbsmag(keidB, primary, classifyFromSimbad('DA2.9')!);
    expect(asSecondary?.source).toBe('dmag_imputed');
    expect(asSecondary?.absmag).toBeCloseTo(3.09, 4);
  });

  it('pair-row-primary escape still prefers the row own absmag when present', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: 8.0, dmag: 1.64, photometryVia: 'athyg_own',
    });
    const r = imputeCompanionAbsmag(sec, primary, SPECTRAL_UNKNOWN, false);
    expect(r?.source).toBe('own');
    expect(r?.absmag).toBe(8.0);
  });
});

describe('hasRenderableOrbit', () => {
  it('true only when P, T, e, a, ω, q are all present', () => {
    expect(hasRenderableOrbit(multiplesRow(ORBIT_ELEMENTS))).toBe(true);
    expect(hasRenderableOrbit(multiplesRow())).toBe(false);
    expect(hasRenderableOrbit(multiplesRow({ ...ORBIT_ELEMENTS, aAU: null }))).toBe(false);
    expect(hasRenderableOrbit(multiplesRow({ ...ORBIT_ELEMENTS, q: null }))).toBe(false);
  });

  it('i is optional (Tier-2 galactic-plane fallback)', () => {
    expect(hasRenderableOrbit(multiplesRow({ ...ORBIT_ELEMENTS, iRad: null }))).toBe(true);
  });
});

describe('imputeCompanionCi', () => {
  const wdInfo = classifyFromSimbad('DA1.9')!;
  const mDwarfInfo = classifyFromSimbad('M3V')!;

  it('derives a hot-WD B-V from the WD subclass when ci is inherited', () => {
    const sec = multiplesRow({
      comp: 'B', ci: 0.009,
      photometryVia: 'athyg_system_inherited',
    });
    const bv = imputeCompanionCi(sec, wdInfo);
    // T_eff(DA1.9) = 50400/2 = 25200 K → Ballesteros⁻¹ ≈ -0.44.
    // The shader's LUT clamps to BV_MIN=-0.4 at lookup time; we store
    // the unclamped value so the raw temperature stays recoverable.
    expect(bv).toBeLessThan(-0.4);
    expect(bv).toBeGreaterThan(-0.5);
  });

  it('uses row.ci when the secondary carries its own photometry', () => {
    const sec = multiplesRow({
      comp: 'B', ci: 1.42, photometryVia: 'athyg_own',
    });
    expect(imputeCompanionCi(sec, mDwarfInfo)).toBe(1.42);
  });

  it('derives from spectral info when row.ci is null', () => {
    const sec = multiplesRow({
      comp: 'B', ci: null, photometryVia: 'none',
    });
    const bv = imputeCompanionCi(sec, mDwarfInfo);
    expect(bv).toBeGreaterThan(0.5);
    expect(bv).toBeLessThan(2.0);
  });

  it('falls through to SOLAR_BV_FALLBACK for unparseable spectral info', () => {
    const sec = multiplesRow({
      comp: 'B', ci: 0.009,
      photometryVia: 'athyg_system_inherited',
    });
    expect(imputeCompanionCi(sec, SPECTRAL_UNKNOWN)).toBe(SOLAR_BV_FALLBACK);
  });

  it('falls through to SOLAR_BV_FALLBACK when spectral classIdx is 8 and not a WD', () => {
    const sec = multiplesRow({
      comp: 'B', ci: null, photometryVia: 'none',
    });
    const unknownButLumClass = { ...SPECTRAL_UNKNOWN, lumClass: 2 };
    expect(imputeCompanionCi(sec, unknownButLumClass)).toBe(SOLAR_BV_FALLBACK);
  });
});

describe('promoteCompanions build-time de-extinction', () => {
  // Uniform-density cube: A_V accrues along the sightline; avSolToStar
  // gives the exact expected subtraction (no hard-coded magic).
  const grid: DustGrid = {
    gridSize: 4, boundsHalfPc: 100, densityMin: 1e-3,
    logRatio: Math.log(100), avPerDensityPc: 2, voxelSizePc: 50,
    data: new Uint8Array(4 * 4 * 4).fill(200),
  };
  const pos = { x: 40, y: 0, z: 0 };
  const av = avSolToStar(grid, pos.x, pos.y, pos.z);

  // Secondary re-anchored per-component (own gaia_5p) so resolvePosition
  // uses its own xyz — the sightline the integral runs down.
  function promoteAt(
    grid: DustGrid | null,
    rowOverrides: Partial<MultiplesTsvRow>,
  ): Star {
    const primaryStar = makeStar({ gaiaSourceId: '111', x: 40, y: 0, z: 0 });
    const primaryRow = multiplesRow({
      comp: 'A', orbitRole: 'primary', gaiaSourceId: '111',
      x_pc: 40, y_pc: 0, z_pc: 0, distPc: 40,
    });
    const secondary = multiplesRow({
      gaiaSourceId: '222', astrometryVia: 'gaia_5p',
      x_pc: pos.x, y_pc: pos.y, z_pc: pos.z, distPc: 40,
      ...rowOverrides,
    });
    const { newStars } = promoteCompanions(
      [primaryRow, secondary], [primaryStar], CONSTELLATIONS, grid,
    );
    expect(newStars).toHaveLength(1);
    return newStars[0];
  }

  it('de-extincts observed absmag and de-reddens the row’s own ci', () => {
    const observed: Partial<MultiplesTsvRow> = {
      photometryVia: 'athyg_own', absmag: 3.0, ci: 0.5, spect: '', dmag: null,
    };
    const withGrid = promoteAt(grid, observed);
    const noGrid = promoteAt(null, observed);
    expect(noGrid.absmag - withGrid.absmag).toBeCloseTo(av, 6);
    expect(noGrid.ci - withGrid.ci).toBeCloseTo(av / R_V, 6);
  });

  it('leaves intrinsic spectral-derived absmag and Ballesteros ci untouched', () => {
    // Inherited photometry + per-component type → class→M_V absmag and
    // Ballesteros ci: both already extinction-free, so no subtraction.
    const intrinsic: Partial<MultiplesTsvRow> = {
      photometryVia: 'athyg_system_inherited', spectVia: 'simbad',
      spect: 'B8V', dmag: null,
    };
    const withGrid = promoteAt(grid, intrinsic);
    const noGrid = promoteAt(null, intrinsic);
    expect(withGrid.absmag).toBeCloseTo(noGrid.absmag, 6);
    expect(withGrid.ci).toBeCloseTo(noGrid.ci, 6);
  });
});


describe('promoteCompanions', () => {
  // 06451-1643-AB shape: Sirius A in AT-HYG (HIP 32349, gaia missing),
  // Sirius B not in AT-HYG. Promotion path should pick B up.
  const sirius_a_existing: Star = makeStar({
    x: -0.494, y: 2.477, z: -0.758,
    absmag: 1.45, ci: 0.01,
    spectClass: 2, lumClass: 2,
    proper: 'Sirius',
    hip: 32349,
    gaiaSourceId: null,
  });

  function siriusRows(): MultiplesTsvRow[] {
    return [
      multiplesRow({
        systemId: '06451-1643-AB', comp: 'A',
        hip: 32349, gaiaSourceId: null,
        x_pc: -0.494399, y_pc: 2.476801, z_pc: -0.758367, distPc: 2.637,
        absmag: 1.45, ci: 0.01, spect: 'A0mA1Va',
        name: 'Sirius',
        source: 'athyg', astrometryVia: 'hip2_long_baseline',
        spectVia: 'simbad',
        orbitRole: 'primary',
        sepArcsec: 11.1, paDeg: 59.0, sepPaEpochJd: 2460311.0,
        dmag: 9.91,
      }),
      multiplesRow({
        systemId: '06451-1643-AB', comp: 'B',
        hip: 32349, gaiaSourceId: '2947050466531873024',
        x_pc: -0.494399, y_pc: 2.476801, z_pc: -0.758367, distPc: 2.637,
        absmag: 1.45, ci: 0.01, spect: 'DA1.9',
        name: 'Sirius',
        source: 'athyg', astrometryVia: 'hip2_long_baseline',
        spectVia: 'simbad',
        photometryVia: 'athyg_system_inherited',
        orbitRole: 'secondary',
        sepArcsec: 11.1, paDeg: 59.0, sepPaEpochJd: 2460311.0,
        dmag: 9.91,
      }),
    ];
  }

  it('promotes Sirius B with imputed absmag, FLAG_BINARY_COMPANION_ONLY, "Sirius B" name', () => {
    const { newStars, stats } = promoteCompanions(siriusRows(), [sirius_a_existing], CONSTELLATIONS);
    expect(stats.promoted).toBe(1);
    expect(stats.alreadyInCatalog).toBe(0);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    expect(b.gaiaSourceId).toBe('2947050466531873024');
    expect(b.absmag).toBeCloseTo(11.36, 4);
    expect(b.proper).toBe('Sirius B');
    // HIP must NOT be inherited — Hipparcos resolved Sirius as one
    // star, so HIP 32349 belongs to A. Sharing it across A and B
    // collapses both records in URL-state's HIP-keyed encoding.
    expect(b.hip).toBeNull();
    expect(b.flags & FLAG_BINARY_COMPANION_ONLY).toBeTruthy();
    expect(b.flags & FLAG_HAS_NAME).toBeTruthy();
    // White dwarf parsing: classifyFromSimbad("DA1.9") → classIdx=8 (the
    // "other / white dwarf" bucket), lumClass=0 (D).
    expect(b.spectClass).toBe(8);
    expect(b.lumClass).toBe(0);
    // ci is recomputed from the WD's blackbody temperature rather
    // than inherited from Sirius A. T(DA1.9)=25200 K → Ballesteros⁻¹
    // ~-0.44; the LUT clamps at lookup, the stored value is uncapped.
    expect(b.ci).toBeLessThan(-0.4);
  });

  it('re-homes a blended inner-pair secondary onto its true parent (Castor Ba,Bb → B, not A)', () => {
    // A and B share one blended identifier (Gaia source + HIP), so the
    // Ba,Bb cursor primary resolves onto A. B still gets its own synth
    // record via the AB pair (measured sep → distinct position). The
    // post-pass must land Bb on B, not on the A sibling it first anchored.
    const GA = '900900900';
    const a_existing: Star = makeStar({
      x: 10, y: 0, z: 0, absmag: 2.0, ci: 0.0,
      proper: 'Castor', hip: 500, gaiaSourceId: GA,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: 'TST-AB', comp: 'A', hip: 500, gaiaSourceId: GA,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        orbitRole: 'primary', sepArcsec: 5.0, paDeg: 90, sepPaEpochJd: 2451545,
      }),
      multiplesRow({
        systemId: 'TST-AB', comp: 'B', hip: 500, gaiaSourceId: GA,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        photometryVia: 'athyg_system_inherited',
        orbitRole: 'secondary', sepArcsec: 5.0, paDeg: 90, sepPaEpochJd: 2451545, dmag: 1.0,
      }),
      multiplesRow({
        systemId: 'TST-Ba,Bb', comp: 'Ba', hip: 500, gaiaSourceId: GA,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        orbitRole: 'primary', sepArcsec: 0,
        pDays: 2.9, tJd: 2451545, e: 0, aAU: 0.05, omegaRad: 3.14, q: 0.14,
      }),
      multiplesRow({
        systemId: 'TST-Ba,Bb', comp: 'Bb', hip: 500, gaiaSourceId: GA,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        photometryVia: 'athyg_system_inherited',
        orbitRole: 'secondary', sepArcsec: 0, dmag: 1.0,
        pDays: 2.9, tJd: 2451545, e: 0, aAU: 0.05, omegaRad: 3.14, q: 0.14,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [a_existing], CONSTELLATIONS);
    const b = newStars.find((s) => s.proper === 'Castor B');
    const bb = newStars.find((s) => s.proper === 'Castor Bb');
    expect(b, 'Castor B promoted').toBeDefined();
    expect(bb, 'Castor Bb promoted').toBeDefined();
    expect(stats.repositionedInnerToParent).toBeGreaterThanOrEqual(1);
    // B is a distinct position from A (measured 5″ sep); Bb collocates on B.
    expect([b!.x, b!.y, b!.z]).not.toEqual([a_existing.x, a_existing.y, a_existing.z]);
    expect([bb!.x, bb!.y, bb!.z]).toEqual([b!.x, b!.y, b!.z]);
  });

  it('names a subdivided inner-pair secondary off the system root, not the component-named local anchor (Castor Ca,Cb → "Castor Cb", not "Castor C Cb")', () => {
    // YY Gem shape: the C component promotes from the AC pair as the
    // component-named "Castor C". The Ca,Cb inner pair's primary Ca then
    // resolves onto that "Castor C" record — so composing the Cb secondary
    // off its local anchor doubled the parent letter ("Castor C" + "Cb" →
    // "Castor C Cb"). The canonical comp "Cb" already encodes the full path
    // from the root, so the base must be the bare system-root "Castor".
    const GA_A = '900900900';
    const GA_C = '800800800';
    const castorA: Star = makeStar({
      x: 10, y: 0, z: 0, absmag: 1.6, ci: 0.0,
      proper: 'Castor', hip: 500, gaiaSourceId: GA_A,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: 'CAS-AC', comp: 'A', hip: 500, gaiaSourceId: GA_A,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        orbitRole: 'primary', sepArcsec: 70, paDeg: 160, sepPaEpochJd: 2451545,
      }),
      multiplesRow({
        systemId: 'CAS-AC', comp: 'C', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        absmag: 9.0, ci: 1.4, spect: 'M0.5Ve', spectVia: 'simbad',
        photometryVia: 'athyg_own', orbitRole: 'secondary',
        sepArcsec: 70, paDeg: 160, sepPaEpochJd: 2451545, dmag: 7.4,
      }),
      multiplesRow({
        systemId: 'CAS-Ca,Cb', comp: 'Ca', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        absmag: 9.0, orbitRole: 'primary', sepArcsec: 0,
        pDays: 2.9, tJd: 2451545, e: 0, aAU: 0.05, omegaRad: 3.14, q: 0.5,
      }),
      multiplesRow({
        systemId: 'CAS-Ca,Cb', comp: 'Cb', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        spect: 'M1Ve', spectVia: 'curated',
        photometryVia: 'athyg_system_inherited', orbitRole: 'secondary',
        sepArcsec: 0, dmag: 1.0,
        pDays: 2.9, tJd: 2451545, e: 0, aAU: 0.05, omegaRad: 3.14, q: 0.5,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [castorA], CONSTELLATIONS);
    const names = newStars.map((s) => s.proper);
    expect(names).toContain('Castor C');
    expect(names).toContain('Castor Cb');
    expect(names).not.toContain('Castor C Cb');
  });

  it('blend-splits the combined light of collocated gaia_photometry records sharing a source (YY Gem Ca/Cb each fainter than the blend)', () => {
    // Gaia fit ONE 5p source over the sub-arcsec YY Gem pair, so both the
    // outer "Castor C" (from the AC pair) and the inner Cb share source
    // GA_C and each derived the source's COMBINED M_V (8.105). Rendering
    // both at 8.105 makes the system ~2× too bright; the post-pass divides
    // the light so the two components sum back to 8.105.
    const GA_A = '900900900';
    const GA_C = '800800800';
    const COMBINED = 8.105;
    const castorA: Star = makeStar({
      x: 10, y: 0, z: 0, absmag: 1.6, ci: 0.0,
      proper: 'Castor', hip: 500, gaiaSourceId: GA_A,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: 'CAS-AC', comp: 'A', hip: 500, gaiaSourceId: GA_A,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: 'Castor',
        orbitRole: 'primary', sepArcsec: 70, paDeg: 160, sepPaEpochJd: 2451545,
      }),
      multiplesRow({
        systemId: 'CAS-AC', comp: 'C', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        absmag: COMBINED, ci: 1.4, spect: 'M0.5Ve', spectVia: 'simbad',
        photometryVia: 'gaia_photometry', orbitRole: 'secondary',
        sepArcsec: 70, paDeg: 160, sepPaEpochJd: 2451545, dmag: 7.4,
      }),
      multiplesRow({
        systemId: 'CAS-Ca,Cb', comp: 'Ca', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        absmag: COMBINED, spect: 'M0.5Ve', spectVia: 'simbad',
        photometryVia: 'gaia_photometry', orbitRole: 'primary', sepArcsec: 0,
        pDays: 0.814, tJd: 2451545, e: 0, aAU: 0.017, omegaRad: 3.14, q: 0.5,
      }),
      multiplesRow({
        systemId: 'CAS-Ca,Cb', comp: 'Cb', hip: null, gaiaSourceId: GA_C,
        x_pc: 10, y_pc: 0, z_pc: 0, distPc: 10, name: '',
        absmag: COMBINED, spect: 'M0.5Ve', spectVia: 'simbad',
        photometryVia: 'gaia_photometry', orbitRole: 'secondary', sepArcsec: 0,
        pDays: 0.814, tJd: 2451545, e: 0, aAU: 0.017, omegaRad: 3.14, q: 0.5,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [castorA], CONSTELLATIONS);
    const c = newStars.find((s) => s.proper === 'Castor C');
    const cb = newStars.find((s) => s.proper === 'Castor Cb');
    const split = COMBINED + 2.5 * Math.log10(2);
    expect(c!.absmag).toBeCloseTo(split, 4);
    expect(cb!.absmag).toBeCloseTo(split, 4);
    // The two split components sum back to the measured combined light.
    const combined = -2.5 * Math.log10(
      10 ** (-0.4 * c!.absmag) + 10 ** (-0.4 * cb!.absmag),
    );
    expect(combined).toBeCloseTo(COMBINED, 4);
    expect(stats.blendSplitRecords).toBe(2);
  });

  describe('stripDoubledParentToken', () => {
    it('strips the parent token only when the base ends in it', () => {
      // Doubling cases: base carries the parent letter the canonical comp
      // re-appends.
      expect(stripDoubledParentToken('Castor C', 'Cb')).toBe('Castor');
      expect(stripDoubledParentToken('Alkalurops B', 'Bb')).toBe('Alkalurops');
      expect(stripDoubledParentToken('HIP 88424 C', 'Cb')).toBe('HIP 88424');
      expect(stripDoubledParentToken('Algol Aa', 'Aa1')).toBe('Algol');
    });
    it('leaves a base whose tail is not the comp parent untouched', () => {
      // "15 Mon" + "Ab" (parent "A") — base does not end in " A".
      expect(stripDoubledParentToken('15 Mon', 'Ab')).toBe('15 Mon');
      expect(stripDoubledParentToken('HIP 22812', 'Bb')).toBe('HIP 22812');
      expect(stripDoubledParentToken('Castor', 'B')).toBe('Castor');   // no parent
      expect(stripDoubledParentToken('Sirius', 'C')).toBe('Sirius');
    });
  });

  it('skips secondaries already in the catalog (matched by gaia)', () => {
    const rows = siriusRows();
    const existing = makeStar({
      gaiaSourceId: '2947050466531873024', hip: 32349, absmag: 11.18,
    });
    const { newStars, stats } = promoteCompanions(rows, [existing, sirius_a_existing], CONSTELLATIONS);
    expect(stats.promoted).toBe(0);
    expect(stats.alreadyInCatalog).toBe(1);
    expect(newStars).toHaveLength(0);
  });

  it('mints a synthetic identifier for secondaries with no own gaia AND no own hip', () => {
    // Algol-Ab shape: pair-row carries neither gaia nor hip on the
    // secondary. The synthetic-ID fallback (`synth-<wds_id>-<comp>`)
    // makes the promoted record addressable from build-runtime-binaries.
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;
    rows[1].hip = null;
    const { newStars, stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoIdentifier).toBe(0);
    expect(stats.promoted).toBe(1);
    expect(stats.promotedSynthetic).toBe(1);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    expect(b.gaiaSourceId).toBeNull();
    expect(b.hip).toBeNull();
    expect(b.syntheticId).toBe('synth-06451-1643-B');
    expect(b.flags & FLAG_BINARY_COMPANION_SYNTHETIC).toBeTruthy();
    expect(b.flags & FLAG_BINARY_COMPANION_ONLY).toBeTruthy();
  });

  it('canonicalises the WDS-truncated bare-digit secondary for both synth ID and display name', () => {
    // Algol Aa1,2: multiples.tsv emits primary comp="Aa1", secondary
    // comp="2". The canonical WDS form is "Aa2"; both the synth key
    // and the proper name must reflect that — otherwise the user-
    // visible name reads "Algol 2" instead of "Algol Aa2".
    const rows = [
      multiplesRow({
        systemId: '03082+4057-Aa1,2', comp: 'Aa1',
        hip: 14576, gaiaSourceId: null,
        x_pc: 14.189408, y_pc: 15.238769, z_pc: 18.072089, distPc: 27.571,
        absmag: -0.112, ci: -0.003, spect: 'B8V',
        name: 'Algol', source: 'athyg',
        astrometryVia: 'hip2_long_baseline', spectVia: 'athyg',
        photometryVia: 'athyg_own', orbitRole: 'primary',
        sepArcsec: 0.0, paDeg: 43.0, sepPaEpochJd: 2455197.5,
      }),
      multiplesRow({
        systemId: '03082+4057-Aa1,2', comp: '2',
        hip: null, gaiaSourceId: null,
        x_pc: 14.189411, y_pc: 15.238771, z_pc: 18.072092, distPc: 27.571,
        absmag: -0.112, ci: -0.003, spect: 'B8V',
        name: '', source: 'athyg',
        astrometryVia: 'athyg_position', spectVia: 'athyg',
        photometryVia: 'athyg_system_inherited', orbitRole: 'secondary',
        sepArcsec: 0.0, paDeg: 43.0, sepPaEpochJd: 2455197.5,
        ...ORBIT_ELEMENTS,
      }),
    ];
    const algolPrimary = makeStar({
      x: 14.189408, y: 15.238769, z: 18.072089,
      absmag: -0.112, hip: 14576, proper: 'Algol',
    });
    const { newStars, stats } = promoteCompanions(rows, [algolPrimary], CONSTELLATIONS);
    expect(stats.promotedSynthetic).toBe(1);
    expect(newStars).toHaveLength(1);
    const aa2 = newStars[0];
    expect(aa2.syntheticId).toBe('synth-03082+4057-Aa2');
    expect(aa2.proper).toBe('Algol Aa2');
  });

  it('drops a secondary when both gaia/hip are blank AND no synth ID can be composed (no comp letter)', () => {
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;
    rows[1].hip = null;
    rows[1].comp = '';
    const { stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoIdentifier).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('promotes a no-gaia secondary whose HIP was inherited from the primary (findExisting escape) and mints a synthetic ID', () => {
    // Hypothetical: Stage 2 returned `unresolved` for B so the secondary
    // carries no gaia, but multiples.tsv inherited the system primary's
    // HIP from AT-HYG. findExisting would match the primary's catalog
    // record via HIP fall-through — the inherited-HIP escape lets
    // promotion proceed anyway. Without a synthetic ID the promoted
    // record would be unaddressable at runtime (both gaia and the
    // stripped hip end up null); the synth-<wds_id>-<comp> identifier
    // is what build-runtime-binaries resolves the secondary side through.
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;       // strip B's distinct gaia
    rows[1].hip = 32349;               // still shares primary's HIP
    rows[1].astrometryVia = 'system_inherited';
    const { newStars, stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.alreadyInCatalog).toBe(0);
    expect(stats.promoted).toBe(1);
    expect(stats.promotedSynthetic).toBe(1);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    // The HIP-inheritance gate strips the inherited HIP so the promoted
    // record doesn't collide with the primary in HIP lookups; the synth
    // ID is what the runtime resolver uses instead.
    expect(b.hip).toBeNull();
    expect(b.gaiaSourceId).toBeNull();
    expect(b.syntheticId).toBe('synth-06451-1643-B');
    expect(b.flags & FLAG_BINARY_COMPANION_SYNTHETIC).toBeTruthy();
  });

  it('promotes a secondary sharing the PRIMARY\'s gaia (blended photocentre) via the inherited-Gaia escape', () => {
    // Shared-photocentre shape (HD 209942, HIP 12638, HIP 7869): Gaia fits one
    // source to the blended sub-arcsec pair, so Stage 2/3 bind the
    // SAME source_id to both rows. findExisting matches the primary's
    // record by gaia — the escape must strip the inherited id, mint a
    // synth record, and NOT classify the row as alreadyInCatalog.
    const primaryWithGaia = makeStar({
      x: -0.494, y: 2.477, z: -0.758,
      absmag: 1.45, proper: 'Testar', hip: 32349,
      gaiaSourceId: '555000111',
    });
    const rows = siriusRows();
    rows[0].gaiaSourceId = '555000111';
    rows[1].gaiaSourceId = '555000111';
    rows[1].hip = null;
    const { newStars, stats } = promoteCompanions(rows, [primaryWithGaia], CONSTELLATIONS);
    expect(stats.alreadyInCatalog).toBe(0);
    expect(stats.promoted).toBe(1);
    expect(stats.promotedSynthetic).toBe(1);
    const b = newStars[0];
    expect(b.gaiaSourceId).toBeNull();
    expect(b.hip).toBeNull();
    expect(b.syntheticId).toBe('synth-06451-1643-B');
    expect(b.flags & FLAG_BINARY_COMPANION_SYNTHETIC).toBeTruthy();
  });

  it('still reports alreadyInCatalog when the row\'s gaia matches a NON-primary record', () => {
    // Discriminator for the inherited-Gaia escape: it only fires when
    // the row's gaia IS the anchor primary's. A different record's
    // gaia is a genuine already-in-catalog hit.
    const otherStar: Star = makeStar({ gaiaSourceId: '777', absmag: 5.0 });
    const rows = siriusRows();
    rows[1].gaiaSourceId = '777';
    const { stats } = promoteCompanions(rows, [sirius_a_existing, otherStar], CONSTELLATIONS);
    expect(stats.alreadyInCatalog).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('still reports alreadyInCatalog for a no-gaia row whose HIP matches a NON-primary AT-HYG record', () => {
    // Discriminator for the inherited-HIP escape: it only fires when the
    // matched catalog row IS the cursor primary. If the secondary's HIP
    // matches some other AT-HYG record entirely (in practice: a SIMBAD
    // cross-ID quirk), the match is a real "already in catalog" hit.
    const otherStar: Star = makeStar({
      gaiaSourceId: null, hip: 99999, absmag: 5.0,
    });
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;
    rows[1].hip = 99999;  // matches `otherStar`, NOT Sirius A
    const { stats } = promoteCompanions(rows, [sirius_a_existing, otherStar], CONSTELLATIONS);
    expect(stats.alreadyInCatalog).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('drops secondaries with no absmag path (no own absmag, no Δmag)', () => {
    const rows = siriusRows();
    rows[1].absmag = null;
    rows[1].dmag = null;
    // Primary's absmag is 1.45 (inherited), so the secondary's null
    // absmag can't ride the inheritance shortcut either.
    rows[0].absmag = null;
    const { stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoAbsmag).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('projects secondary position from sep+PA when astrometry is system_inherited', () => {
    const rows = siriusRows();
    rows[1].astrometryVia = 'system_inherited';
    const { newStars } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    // Tangent-plane offset of 11.1″ at 2.637 pc ≈ 1.42e-4 pc. Companion
    // sits within that of the primary.
    const b = newStars[0];
    const dx = b.x - sirius_a_existing.x;
    const dy = b.y - sirius_a_existing.y;
    const dz = b.z - sirius_a_existing.z;
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(sep).toBeGreaterThan(0);
    expect(sep).toBeLessThan(1e-3);
  });

  it("anchors the tangent projection on the EXISTING catalog star, not the multiples.tsv primary row", () => {
    // Pipeline-precision gap: AT-HYG truncates xyz to ~3 sig figs
    // (-0.494, 2.477, -0.758), the binaries pipeline keeps 6 from
    // HIP2 (-0.494399, 2.476801, -0.758367). Their delta (~100 AU
    // for Sirius) must NOT leak into the companion's offset from the
    // existing primary record.
    const rows = siriusRows();
    expect(rows[0].x_pc).toBe(-0.494399);  // multiples.tsv primary
    expect(sirius_a_existing.x).toBeCloseTo(-0.494, 3);  // catalog primary
    const { newStars } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    // Sep+PA at 11.1″ × 2.637 pc / 206265 ≈ 1.42e-4 pc ≈ 29 AU. The
    // companion must land within ~one sep_arcsec of the primary's
    // CATALOG xyz, not anywhere near the pipeline-precision gap.
    const dx = b.x - sirius_a_existing.x;
    const dy = b.y - sirius_a_existing.y;
    const dz = b.z - sirius_a_existing.z;
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(sep).toBeLessThan(2e-4);
    // And distinctly NOT at the multiples.tsv primary row's xyz —
    // would be the case if we'd anchored on the wrong source.
    const dxRow = b.x - rows[0].x_pc!;
    expect(Math.abs(dxRow)).toBeGreaterThan(1e-5);
  });

  it('projects from sep+PA when the secondary xyz differs from primary only by Stage 3 float residue (HIP-only-system case)', () => {
    // Algol Aa,Ab shape: primary route is hip2_long_baseline, secondary
    // route is athyg_position. Both anchor on the same AT-HYG row, but
    // different float paths through Stage 3 leave a µpc-scale residue
    // (here ~3 µpc on x, ~2 µpc on y, ~3 µpc on z → ~5 µpc total ≈ 1
    // mAU). Strict-equality collocation detection misses this and the
    // secondary lands at multiples.tsv xyz while the catalog primary
    // stays at AT-HYG-truncated xyz → ~100 AU gap.
    const algolPrimary = makeStar({
      // AT-HYG-truncated catalog xyz (Stage 3 vs catalog can also drift):
      x: 14.18941, y: 15.23877, z: 18.07209,
      absmag: -0.112, hip: 14576, proper: 'Algol',
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '03082+4057-Aa,Ab', comp: 'Aa',
        hip: 14576, gaiaSourceId: null,
        x_pc: 14.189408, y_pc: 15.238769, z_pc: 18.072089, distPc: 27.571,
        absmag: -0.112, ci: -0.003, spect: 'B8V',
        name: 'Algol', source: 'athyg',
        astrometryVia: 'hip2_long_baseline', spectVia: 'athyg',
        photometryVia: 'athyg_own', orbitRole: 'primary',
        sepArcsec: 0.1, paDeg: 304.0, sepPaEpochJd: 2455197.5,
        dmag: 2.48,
      }),
      multiplesRow({
        systemId: '03082+4057-Aa,Ab', comp: 'Ab',
        hip: null, gaiaSourceId: null,
        // 3 µpc, 2 µpc, 3 µpc deltas — far below 10 AU tolerance,
        // far above strict equality.
        x_pc: 14.189411, y_pc: 15.238771, z_pc: 18.072092, distPc: 27.571,
        absmag: -0.112, ci: -0.003, spect: 'B8V',
        name: '', source: 'athyg',
        astrometryVia: 'athyg_position', spectVia: 'athyg',
        photometryVia: 'athyg_system_inherited', orbitRole: 'secondary',
        sepArcsec: 0.1, paDeg: 304.0, sepPaEpochJd: 2455197.5,
        dmag: 2.48,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [algolPrimary], CONSTELLATIONS);
    expect(stats.promotedSynthetic).toBe(1);
    expect(newStars).toHaveLength(1);
    const ab = newStars[0];
    // Tangent projection from CATALOG anchor at 0.1″ × 27.571 pc /
    // 206264.8 ≈ 1.34e-5 pc ≈ 2.76 AU. Without the tolerance fix Ab
    // would land at multiples.tsv xyz, which is offset from the catalog
    // anchor by max(|dx|=2e-6, |dy|=2e-6, |dz|=2e-6) ~ several mAU plus
    // the catalog truncation delta (~µpc here, can be O(0.1 pc) at
    // wider precision gaps) — neither matches the published 2.76 AU.
    const dx = ab.x - algolPrimary.x;
    const dy = ab.y - algolPrimary.y;
    const dz = ab.z - algolPrimary.z;
    const sepPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sepAu = sepPc * 206264.80624709636;
    expect(sepAu).toBeGreaterThan(2.5);
    expect(sepAu).toBeLessThan(3.0);
  });

  it('honours own per-component astrometry when xyz delta exceeds the collocation tolerance', () => {
    // Hypothetical resolved-Gaia secondary that has its OWN per-component
    // fit ~50 AU from the primary anchor. The collocation tolerance must
    // NOT catch this — the row's own xyz is the authoritative position.
    const primaryRow = multiplesRow({
      orbitRole: 'primary', comp: 'A',
      hip: 32349, gaiaSourceId: null,
      x_pc: 0, y_pc: 0, z_pc: 2.637, distPc: 2.637,
      absmag: 1.45, name: 'Test',
      astrometryVia: 'gaia_5p',
    });
    const secondaryRow = multiplesRow({
      orbitRole: 'secondary', comp: 'B',
      hip: null, gaiaSourceId: '999',
      // 50 AU from primary on z → above the 10 AU tolerance, should win.
      x_pc: 0, y_pc: 0, z_pc: 2.637 + 50 / 206264.80624709636,
      distPc: 2.637, absmag: 11.5, ci: 0.0, spect: 'M5V',
      name: 'Test', astrometryVia: 'gaia_5p',
      photometryVia: 'athyg_own',
    });
    const existing = makeStar({
      x: 0, y: 0, z: 2.637, absmag: 1.45, hip: 32349, proper: 'Test',
    });
    const { newStars } = promoteCompanions([primaryRow, secondaryRow], [existing], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    // Companion takes its own z (own-astrometry branch), not sep+PA from
    // primary anchor.
    expect(newStars[0].z).toBeCloseTo(2.637 + 50 / 206264.80624709636, 8);
  });

  it('projects from sep+PA when the secondary shares xyz with the primary (shared-HIP case)', () => {
    // Sirius A and B both list HIP 32349, so Stage 3 of the binary
    // pipeline emits identical xyz on both rows even though
    // astrometry_via reads hip2_long_baseline. Without the
    // collocation detection the companion lands on top of the primary
    // and the renderer sees both at the same screen pixel.
    const rows = siriusRows();
    expect(rows[0].astrometryVia).toBe('hip2_long_baseline');
    expect(rows[1].astrometryVia).toBe('hip2_long_baseline');
    expect(rows[1].x_pc).toBe(rows[0].x_pc);
    const { newStars } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    const dx = b.x - sirius_a_existing.x;
    const dy = b.y - sirius_a_existing.y;
    const dz = b.z - sirius_a_existing.z;
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(sep).toBeGreaterThan(0);
    expect(sep).toBeLessThan(1e-3);
  });

  it('drops a secondary when sep_arcsec is the WDS -1 sentinel (no measured separation)', () => {
    // Spica-shape: WDS Summary emits rho=-1 / theta=-1 for pairs whose
    // separation isn't measured. The sep+PA tangent branch must reject
    // the sentinel rather than projecting -1″ as a real offset.
    const rows = siriusRows();
    rows[1].astrometryVia = 'athyg_position';
    rows[1].sepArcsec = -1.0;
    rows[1].paDeg = -1.0;
    const { stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoPosition).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('drops a secondary when astrometry is system_inherited but sep+PA are missing', () => {
    const rows = siriusRows();
    rows[1].astrometryVia = 'system_inherited';
    rows[1].sepArcsec = null;
    rows[1].paDeg = null;
    const { stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoPosition).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('repositions a collocated AT-HYG double entry instead of minting a duplicate (ξ UMa B class)', () => {
    // AT-HYG carries BOTH members of the pair at the same printed
    // blend coordinates: "Testar" and "Testar B" bit-identical. The
    // promoted secondary composes the name "Testar B" — that record IS
    // the companion; it must move to the projected position and adopt
    // the row's gaia, and no new record may be created.
    const primaryStar = makeStar({
      x: -0.494, y: 2.477, z: -0.758,
      absmag: 4.24, proper: 'Testar', hip: 55203,
    });
    const athygB = makeStar({
      x: -0.494, y: 2.477, z: -0.758,
      absmag: 4.71, proper: 'Testar B',
    });
    const rows = siriusRows();
    rows[0].hip = 55203;
    rows[0].name = 'Testar';
    rows[1].hip = null;
    rows[1].name = '';
    const { newStars, stats } = promoteCompanions(
      rows, [primaryStar, athygB], CONSTELLATIONS,
    );
    expect(stats.repositionedCollocatedDouble).toBe(1);
    expect(stats.promoted).toBe(0);
    expect(newStars).toHaveLength(0);
    // Moved off the primary to the tangent-projected position…
    expect(athygB.x).not.toBe(primaryStar.x);
    // …keeping its own photometry, adopting the row's gaia for the
    // runtime binaries resolver.
    expect(athygB.absmag).toBe(4.71);
    expect(athygB.gaiaSourceId).toBe('2947050466531873024');
  });

  it('drops a sep-0.000 secondary with no renderable orbit (ξ UMa Bb class)', () => {
    // Sub-resolution spectroscopic pair with NO orbital elements:
    // nothing can ever separate the collocated record from its anchor,
    // and its light is already in the anchor's blend photometry —
    // promoting it renders a duplicate star inside the primary's disc.
    const rows = siriusRows();
    rows[1].astrometryVia = 'athyg_position';
    rows[1].sepArcsec = 0.0;
    rows[1].paDeg = 75.0;
    const { stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoPosition).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('collocates a sep-0.000 ORBITAL secondary bit-identically on the anchor (zero-baseline bake)', () => {
    const rows = siriusRows();
    rows[1].astrometryVia = 'athyg_position';
    rows[1].sepArcsec = 0.0;
    rows[1].paDeg = 43.0;
    Object.assign(rows[1], ORBIT_ELEMENTS);
    const { newStars, stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.promoted).toBe(1);
    expect(newStars[0].x).toBe(sirius_a_existing.x);
    expect(newStars[0].y).toBe(sirius_a_existing.y);
    expect(newStars[0].z).toBe(sirius_a_existing.z);
  });

  it('collocates an unmeasured-sep (WDS -1 sentinel) ORBITAL secondary instead of dropping it', () => {
    // Spica-shape spectroscopic pairs with elements but no measured
    // rho: previously droppedNoPosition; the zero-baseline bake lets
    // the runtime place them via R(t).
    const rows = siriusRows();
    rows[1].astrometryVia = 'athyg_position';
    rows[1].sepArcsec = -1.0;
    rows[1].paDeg = -1.0;
    Object.assign(rows[1], ORBIT_ELEMENTS);
    const { newStars, stats } = promoteCompanions(rows, [sirius_a_existing], CONSTELLATIONS);
    expect(stats.droppedNoPosition).toBe(0);
    expect(stats.promoted).toBe(1);
    expect(newStars[0].x).toBe(sirius_a_existing.x);
  });

  it("falls back to primary Star's proper when both multiples name cells are blank", () => {
    // Stage 6's name cell can be blank on BOTH primary and secondary rows
    // even when the primary's AT-HYG record has a perfectly good proper.
    // The promoted companion must reach for the primary Star (post-
    // override) rather than coming out anonymous.
    const primary = makeStar({
      gaiaSourceId: 'g_prim', proper: 'AnchorName', conIndex: 0,
    });
    const rows = [
      multiplesRow({
        systemId: 'WDS-X-AB', comp: 'A',
        gaiaSourceId: 'g_prim', name: '',
        x_pc: 0, y_pc: 0, z_pc: 10, distPc: 10,
        absmag: 5.0, orbitRole: 'primary',
        sepArcsec: 1.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 4.0,
      }),
      multiplesRow({
        systemId: 'WDS-X-AB', comp: 'B',
        gaiaSourceId: 'g_sec', name: '',
        x_pc: 0, y_pc: 0, z_pc: 10, distPc: 10,
        absmag: 5.0, ci: 0.6, spect: 'M3V',
        photometryVia: 'athyg_system_inherited', orbitRole: 'secondary',
        sepArcsec: 1.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 4.0,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [primary], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    expect(newStars[0].proper).toBe('AnchorName B');
  });

  it("falls back to Bayer + constellation abbrev when primary has no proper (xi Boo shape)", () => {
    // xi Boo A (HIP 72659) carries bayer="Xi", flam=37, conIndex=Boo,
    // but proper=null. composeCompanionName must reach the Bayer ladder
    // to produce a searchable "Xi Boo B" rather than dropping the name.
    const booIdx = CONSTELLATIONS.findIndex(c => c.code === 'Boo');
    const primary = makeStar({
      gaiaSourceId: 'g_xiboo', proper: null, bayer: 'Xi',
      flam: 37, conIndex: booIdx,
    });
    const rows = [
      multiplesRow({
        systemId: 'WDS-Y-AB', comp: 'A',
        gaiaSourceId: 'g_xiboo', name: '',
        x_pc: 0, y_pc: 0, z_pc: 6.7, distPc: 6.7,
        absmag: 5.0, orbitRole: 'primary',
        sepArcsec: 5.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.5,
      }),
      multiplesRow({
        systemId: 'WDS-Y-AB', comp: 'B',
        gaiaSourceId: 'g_xiboo_b', name: '',
        x_pc: 0, y_pc: 0, z_pc: 6.7, distPc: 6.7,
        absmag: 6.5, ci: 1.0, spect: 'K4V',
        photometryVia: 'athyg_own', orbitRole: 'secondary',
        sepArcsec: 5.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.5,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [primary], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    expect(newStars[0].proper).toBe('Xi Boo B');
  });

  it("falls back to Flamsteed + constellation abbrev when bayer is absent (70 Oph shape)", () => {
    // 70 Oph A (HIP 88601) carries flam=70, conIndex=Oph, but proper=null
    // AND bayer=null. The Flamsteed step in the fallback ladder produces
    // "70 Oph B".
    const ophIdx = CONSTELLATIONS.findIndex(c => c.code === 'Oph');
    const primary = makeStar({
      gaiaSourceId: 'g_70oph', proper: null, bayer: null,
      flam: 70, conIndex: ophIdx,
    });
    const rows = [
      multiplesRow({
        systemId: 'WDS-Z-AB', comp: 'A',
        gaiaSourceId: 'g_70oph', name: '',
        x_pc: 0, y_pc: 0, z_pc: 5.1, distPc: 5.1,
        absmag: 5.7, orbitRole: 'primary',
        sepArcsec: 6.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.7,
      }),
      multiplesRow({
        systemId: 'WDS-Z-AB', comp: 'B',
        gaiaSourceId: 'g_70oph_b', name: '',
        x_pc: 0, y_pc: 0, z_pc: 5.1, distPc: 5.1,
        absmag: 7.4, ci: 1.2, spect: 'K5V',
        photometryVia: 'athyg_own', orbitRole: 'secondary',
        sepArcsec: 6.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.7,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [primary], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    expect(newStars[0].proper).toBe('70 Oph B');
  });

  it("returns null name when primary has no proper, no Bayer, no Flamsteed", () => {
    // No identifier ladder anchor — refuse rather than emitting
    // constellation-only ("Boo B") which would collide with every
    // unnamed star in the same constellation.
    const booIdx = CONSTELLATIONS.findIndex(c => c.code === 'Boo');
    const primary = makeStar({
      gaiaSourceId: 'g_anon', proper: null, bayer: null,
      flam: null, conIndex: booIdx,
    });
    const rows = [
      multiplesRow({
        systemId: 'WDS-W-AB', comp: 'A',
        gaiaSourceId: 'g_anon', name: '',
        x_pc: 0, y_pc: 0, z_pc: 20, distPc: 20,
        absmag: 5.0, orbitRole: 'primary',
        sepArcsec: 2.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.0,
      }),
      multiplesRow({
        systemId: 'WDS-W-AB', comp: 'B',
        gaiaSourceId: 'g_anon_b', name: '',
        x_pc: 0, y_pc: 0, z_pc: 20, distPc: 20,
        absmag: 6.0, ci: 1.0, spect: 'M0V',
        photometryVia: 'athyg_own', orbitRole: 'secondary',
        sepArcsec: 2.0, paDeg: 0.0, sepPaEpochJd: 2460000.0,
        dmag: 1.0,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [primary], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    expect(newStars[0].proper).toBeNull();
  });

  it('names a companion of a name-less HIP-only system by the primary HIP designation', () => {
    // HIP 18734 AB shape: the whole system is name-less — the primary is a
    // bare HIP record (no proper / Bayer / Flamsteed), so every earlier name
    // tier is empty and the companion used to ship "Unnamed #idx". The HIP
    // designation fallback (mirroring the runtime buildStarLabels tiers)
    // composes "HIP 18734 B".
    const primary = makeStar({
      hip: 18734, gaiaSourceId: 'g_18734', proper: null, bayer: null,
      flam: null, conIndex: 255, x: 0, y: 0, z: 40,
    });
    const rows = [
      multiplesRow({
        systemId: '04008+0505-AB', comp: 'A',
        hip: 18734, gaiaSourceId: 'g_18734', name: '',
        x_pc: 0, y_pc: 0, z_pc: 40, distPc: 40,
        absmag: 2.0, orbitRole: 'primary',
        sepArcsec: 1.0, paDeg: 0.0, sepPaEpochJd: 2460000.0, dmag: 0.5,
      }),
      multiplesRow({
        systemId: '04008+0505-AB', comp: 'B',
        hip: null, gaiaSourceId: 'g_18734_b', name: '',
        x_pc: 0, y_pc: 0, z_pc: 40, distPc: 40,
        absmag: 2.5, ci: 0.2, spect: 'A3V',
        photometryVia: 'athyg_own', orbitRole: 'secondary',
        sepArcsec: 1.0, paDeg: 0.0, sepPaEpochJd: 2460000.0, dmag: 0.5,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [primary], CONSTELLATIONS);
    expect(newStars).toHaveLength(1);
    expect(newStars[0].proper).toBe('HIP 18734 B');
  });

  it('drops a pair-row primary with no compound proxy and no independent astrometry (Alsephina C class)', () => {
    // δ Vel C carries its own gaia_source_id but the binaries pipeline
    // only re-anchored it to the system position (system_inherited), and
    // the WDS root has no unresolved-compound sibling containing "C" to
    // borrow an A→C sep+PA from. With neither an independent per-component
    // fit nor a compound proxy, collocating C on the anchor bakes a false
    // coincident star inside δ Vel A's disc — no anchor→C orbital pair
    // exists to animate it away at runtime. Drop instead.
    const alsephina: Star = makeStar({
      gaiaSourceId: null, hip: 42913,
      absmag: -0.033, proper: 'Alsephina',
      x: -9.394045, y: 10.739872, z: -20.158656,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '08447-5443-AB', comp: 'A',
        gaiaSourceId: null, hip: 42913,
        x_pc: -9.394045, y_pc: 10.739872, z_pc: -20.158656, distPc: 24.697,
        absmag: -0.033, name: 'Alsephina', source: 'athyg',
        astrometryVia: 'hip2_long_baseline', orbitRole: 'primary',
        sepArcsec: 1.1, paDeg: 185.0, sepPaEpochJd: 2459945.75, dmag: 3.58,
      }),
      multiplesRow({
        systemId: '08447-5443-CD', comp: 'C',
        gaiaSourceId: '5317053587002655872', hip: null,
        x_pc: -9.394045, y_pc: 10.739872, z_pc: -20.158656, distPc: 24.697,
        absmag: 2.467, ci: 0.77, spect: 'G8',
        photometryVia: 'none', name: '',
        astrometryVia: 'system_inherited', orbitRole: 'primary',
        sepArcsec: 5.6, paDeg: 86.0, sepPaEpochJd: 2457023.75, dmag: 2.5,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [alsephina], CONSTELLATIONS);
    expect(stats.droppedCollocatedPrimary).toBe(1);
    expect(stats.promoted).toBe(0);
    expect(newStars.find(s => s.gaiaSourceId === '5317053587002655872'))
      .toBeUndefined();
  });

  it('places a pair-row primary at its own per-component gaia_5p astrometry when available', () => {
    // When Stage 3 gave the pair-row primary a real independent fit (own
    // gaia_5p whose xyz is re-anchored per-component), its own position
    // wins over both the compound-proxy projection and the drop path.
    const anchor: Star = makeStar({
      gaiaSourceId: 'g_anchor_a', hip: 12345,
      absmag: 4.0, proper: 'Testar',
      x: 10.0, y: 0.0, z: 0.0,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: 'test-0000-AB', comp: 'A',
        gaiaSourceId: 'g_anchor_a', hip: 12345,
        x_pc: 10.0, y_pc: 0.0, z_pc: 0.0, distPc: 10.0,
        absmag: 4.0, name: 'Testar', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 2.0, paDeg: 45.0, sepPaEpochJd: 2460000.0, dmag: 1.0,
      }),
      multiplesRow({
        systemId: 'test-0000-CD', comp: 'C',
        gaiaSourceId: 'g_pair_c', hip: null,
        x_pc: 10.001, y_pc: 0.0005, z_pc: 0.0, distPc: 10.001,
        absmag: 6.0, ci: 0.9, spect: 'K3V', name: '',
        photometryVia: 'athyg_own',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 3.0, paDeg: 90.0, sepPaEpochJd: 2460000.0, dmag: 2.0,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [anchor], CONSTELLATIONS);
    expect(stats.promoted).toBe(1);
    expect(stats.droppedCollocatedPrimary).toBe(0);
    const c = newStars.find(s => s.gaiaSourceId === 'g_pair_c');
    expect(c, 'C promoted at own astrometry').toBeDefined();
    if (!c) return;
    expect(c.x).toBeCloseTo(10.001, 6);
    expect(c.y).toBeCloseTo(0.0005, 6);
    expect(c.z).toBeCloseTo(0.0, 6);
  });

  it('names a secondary off the WDS-root system primary when its sub-pair local primary is nameless and unpromoted (Alsephina D)', () => {
    // δ Vel D is the secondary of the CD sub-pair. Its local primary C is
    // nameless (source=wds, empty name) and can't promote (system_inherited,
    // no compound proxy — see the Alsephina C test above), so the cursor
    // anchor is null. D still promotes off C's inherited position, and its
    // name must climb to the WDS-root system primary (A = "Alsephina") →
    // "Alsephina D", not Unnamed.
    const alsephina: Star = makeStar({
      gaiaSourceId: null, hip: 42913,
      absmag: -0.033, proper: 'Alsephina',
      x: -9.394045, y: 10.739872, z: -20.158656,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '08447-5443-AB', comp: 'A',
        gaiaSourceId: null, hip: 42913,
        x_pc: -9.394045, y_pc: 10.739872, z_pc: -20.158656, distPc: 24.697,
        absmag: -0.033, name: 'Alsephina', source: 'athyg',
        astrometryVia: 'hip2_long_baseline', orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '08447-5443-CD', comp: 'C',
        gaiaSourceId: '5317053587002655872', hip: null,
        x_pc: -9.394045, y_pc: 10.739872, z_pc: -20.158656, distPc: 24.697,
        absmag: 2.467, ci: 0.77, spect: 'G8', name: '',
        photometryVia: 'none', astrometryVia: 'system_inherited',
        orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '08447-5443-CD', comp: 'D',
        gaiaSourceId: '5317053587001807104', hip: null,
        x_pc: -9.394045, y_pc: 10.739872, z_pc: -20.158656, distPc: 24.697,
        absmag: 5.90, ci: 0.845, spect: 'K0', name: '',
        photometryVia: 'none', astrometryVia: 'system_inherited',
        orbitRole: 'secondary',
        sepArcsec: 6.0, paDeg: 100.0, sepPaEpochJd: 2457023.75, dmag: 3.4,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [alsephina], CONSTELLATIONS);
    expect(stats.droppedCollocatedPrimary).toBe(1);  // C still drops
    const d = newStars.find(s => s.gaiaSourceId === '5317053587001807104');
    expect(d, 'D promoted').toBeDefined();
    expect(d?.proper).toBe('Alsephina D');
  });

  it('names a secondary off the WDS-root system primary when its local anchor is present but nameless (Eps Equ C)', () => {
    // ε Equ's BC sub-pair: the local primary B resolves to an existing but
    // nameless catalog record (HIP 103571 — no proper/Bayer/Flamsteed),
    // while the system primary A is the named first-class "Eps Equ"
    // (HIP 103569). C's name must climb past the nameless local anchor to
    // the WDS-root system primary → "Eps Equ C", not Unnamed.
    const epsEquA: Star = makeStar({
      gaiaSourceId: null, hip: 103569,
      absmag: 1.5, proper: 'Eps Equ',
      x: 30.0, y: 40.0, z: 10.0,
    });
    const epsEquB: Star = makeStar({
      gaiaSourceId: null, hip: 103571,   // nameless: no proper/bayer/flam
      absmag: 5.0, x: 30.01, y: 40.01, z: 10.0,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '20591+0418-AB', comp: 'A',
        gaiaSourceId: null, hip: 103569,
        x_pc: 30.0, y_pc: 40.0, z_pc: 10.0, distPc: 54.08,
        absmag: 1.5, name: 'Eps Equ', source: 'athyg',
        astrometryVia: 'hip2_long_baseline', orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '20591+0418-BC', comp: 'B',
        gaiaSourceId: null, hip: 103571,
        x_pc: 30.01, y_pc: 40.01, z_pc: 10.0, distPc: 55.04,
        absmag: 5.0, name: '', source: 'wds',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '20591+0418-BC', comp: 'C',
        gaiaSourceId: '1731592451377571712', hip: null,
        x_pc: 30.01, y_pc: 40.01, z_pc: 10.0, distPc: 55.04,
        absmag: 6.5, ci: 0.5, spect: 'F5', name: '',
        photometryVia: 'none', astrometryVia: 'system_inherited',
        orbitRole: 'secondary',
        sepArcsec: 10.0, paDeg: 200.0, sepPaEpochJd: 2457023.75, dmag: 1.5,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [epsEquA, epsEquB], CONSTELLATIONS);
    const c = newStars.find(s => s.gaiaSourceId === '1731592451377571712');
    expect(c, 'C promoted').toBeDefined();
    expect(c?.proper).toBe('Eps Equ C');
  });

  it('drops the unresolved-compound secondary "BC" and projects pair-row "B" off the A,BC sep+PA', () => {
    // 40 Eri (canonical case). The A,BC group's secondary "BC" is the
    // WDS unresolved-compound; it must NOT promote (otherwise the
    // catalog gets a ghost "Keid BC" record at ~416 AU from A, alongside
    // the resolved "Keid B" and "Keid C" — double-counting the BC
    // aggregate). And the pair-row primary "B" — appearing in BC, BD,
    // BE groups but never as a secondary of A — must NOT collocate at
    // A; it should land at the A,BC group's projected sep+PA (the only
    // available proxy for A→B since no AB orbital pair animates B at
    // runtime).
    const keid: Star = makeStar({
      gaiaSourceId: '3195919528989223040', hip: 19849,
      absmag: 5.931, proper: 'Keid',
      x: 2.191467, y: 4.455210, z: -0.668480,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '04153-0739-A,BC', comp: 'A',
        gaiaSourceId: '3195919528989223040', hip: 19849,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, name: 'Keid', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 83.2, paDeg: 108.0, sepPaEpochJd: 2460311.0, dmag: 5.7,
      }),
      multiplesRow({
        systemId: '04153-0739-A,BC', comp: 'BC',
        gaiaSourceId: null, hip: null,  // compound — no own identifier
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.4, spect: '',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 83.2, paDeg: 108.0, sepPaEpochJd: 2460311.0, dmag: 5.7,
      }),
      multiplesRow({
        systemId: '04153-0739-AC', comp: 'A',
        gaiaSourceId: '3195919528989223040', hip: 19849,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, name: 'Keid', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 77.9, paDeg: 98.0, sepPaEpochJd: 2460311.0, dmag: 6.74,
      }),
      multiplesRow({
        systemId: '04153-0739-AC', comp: 'C',
        gaiaSourceId: '3195919254111314816', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, ci: 0.82, spect: 'M4.5V',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 77.9, paDeg: 98.0, sepPaEpochJd: 2460311.0, dmag: 6.74,
      }),
      multiplesRow({
        systemId: '04153-0739-BC', comp: 'B',
        gaiaSourceId: '3195919254111315712', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: null, ci: 0.0, spect: 'DA2.9',
        photometryVia: 'none', spectVia: 'simbad', name: '',
        astrometryVia: 'system_inherited', orbitRole: 'primary',
        sepArcsec: 7.7, paDeg: 327.0, sepPaEpochJd: 2460311.0, dmag: 1.64,
      }),
      multiplesRow({
        systemId: '04153-0739-BC', comp: 'C',
        gaiaSourceId: '3195919254111314816', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.82, spect: 'M4.5V',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 7.7, paDeg: 327.0, sepPaEpochJd: 2460311.0, dmag: 1.64,
      }),
    ];
    const { newStars, stats } = promoteCompanions(rows, [keid], CONSTELLATIONS);
    // The "BC" compound row drops; B and C both promote.
    expect(stats.droppedCompoundComp).toBe(1);
    expect(stats.promoted).toBe(2);
    const properNames = newStars.map(s => s.proper).sort();
    expect(properNames).toEqual(['Keid B', 'Keid C']);
    expect(newStars.find(s => s.proper === 'Keid BC')).toBeUndefined();
    // B's xyz comes from projecting A,BC's 83.2″ / 108° off the anchor —
    // NOT collocated on Keid (collocation would put B inside A's disc
    // when no AB orbital pair animates it at runtime).
    const b = newStars.find(s => s.proper === 'Keid B');
    expect(b).toBeDefined();
    if (!b) return;
    expect(b.absmag).toBe(5.931);
    expect(stats.absmagAnchorCollocated).toBe(1);
    const dxAuFromKeid = Math.hypot(
      b.x - keid.x, b.y - keid.y, b.z - keid.z,
    ) * 206264.806;  // pc → AU at 1 pc, scaled by Keid's distance
    // 83.2″ at Keid's distance (~5 pc) projects to ~416 AU separation.
    expect(dxAuFromKeid).toBeGreaterThan(300);
    expect(dxAuFromKeid).toBeLessThan(500);
  });

  it('reuses a freshly-promoted pair-row primary as the anchor for later sub-pair groups', () => {
    // 40 Eri's BD group has B as primary again. By the time we reach
    // BD, B was promoted in BC (projected off the A,BC compound proxy).
    // The BD secondary D must find B via the promoted-record lookup
    // (otherwise D would also need the pair-row-primary escape, which
    // doesn't apply to D since D never appears as a primary).
    const keid: Star = makeStar({
      gaiaSourceId: '3195919528989223040', hip: 19849,
      absmag: 5.931, proper: 'Keid',
      x: 2.191467, y: 4.455210, z: -0.668480,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '04153-0739-A,BC', comp: 'A',
        gaiaSourceId: '3195919528989223040', hip: 19849,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, name: 'Keid', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 83.2, paDeg: 108.0, sepPaEpochJd: 2460311.0, dmag: 5.7,
      }),
      multiplesRow({
        systemId: '04153-0739-A,BC', comp: 'BC',
        gaiaSourceId: null, hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.4, spect: '',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 83.2, paDeg: 108.0, sepPaEpochJd: 2460311.0, dmag: 5.7,
      }),
      multiplesRow({
        systemId: '04153-0739-AC', comp: 'A',
        gaiaSourceId: '3195919528989223040', hip: 19849,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, name: 'Keid', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 77.9, paDeg: 98.0, sepPaEpochJd: 2460311.0, dmag: 6.74,
      }),
      multiplesRow({
        systemId: '04153-0739-BC', comp: 'B',
        gaiaSourceId: '3195919254111315712', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.0, spect: 'DA2.9',
        photometryVia: 'athyg_own', name: '',
        astrometryVia: 'system_inherited', orbitRole: 'primary',
        sepArcsec: 7.7, paDeg: 327.0, sepPaEpochJd: 2460311.0, dmag: 1.64,
      }),
      multiplesRow({
        systemId: '04153-0739-BC', comp: 'C',
        gaiaSourceId: '3195919254111314816', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.82, spect: 'M4.5V',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 7.7, paDeg: 327.0, sepPaEpochJd: 2460311.0, dmag: 1.64,
      }),
      multiplesRow({
        systemId: '04153-0739-BD', comp: 'B',
        gaiaSourceId: '3195919254111315712', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.0, spect: 'DA2.9',
        photometryVia: 'athyg_own', name: '',
        astrometryVia: 'system_inherited', orbitRole: 'primary',
        sepArcsec: 521.0, paDeg: 29.0, sepPaEpochJd: 2457389.0, dmag: 3.09,
      }),
      multiplesRow({
        systemId: '04153-0739-BD', comp: 'D',
        gaiaSourceId: '3196027418567684992', hip: null,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 1.5, spect: 'M5V',
        photometryVia: 'athyg_system_inherited',
        astrometryVia: 'system_inherited', orbitRole: 'secondary',
        sepArcsec: 521.0, paDeg: 29.0, sepPaEpochJd: 2457389.0, dmag: 3.09,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [keid], CONSTELLATIONS);
    // C, B, D all promoted. Only one B record (the BD group's "B primary"
    // hits the promoted lookup and short-circuits the escape).
    const gaiaIds = newStars.map(s => s.gaiaSourceId).sort();
    expect(gaiaIds).toEqual([
      '3195919254111314816',  // C
      '3195919254111315712',  // B
      '3196027418567684992',  // D
    ].sort());
    // D's name composes through Keid (via B→Keid chain... actually D's
    // primary in BD is B, and B's proper is "Keid B", so composeCompanionName
    // gets base="Keid B" → "Keid B D". Reasonable for now; sibling-pair
    // bead can tighten if the form looks wrong in practice.
    const d = newStars.find(s => s.gaiaSourceId === '3196027418567684992');
    expect(d?.proper).toMatch(/^Keid B/);
  });

  it('skips pair-row-primary promotion when the row has no own gaia AND no own hip', () => {
    // Defensive: a pair-row primary without an identifier can't be
    // addressed post-promotion. Falls through with no escape; the
    // cursor's secondaries proceed without an anchor, and most drop
    // for lack of a primary's catalog row.
    const keid: Star = makeStar({
      gaiaSourceId: '3195919528989223040', hip: 19849,
      absmag: 5.931, proper: 'Keid',
      x: 2.191467, y: 4.455210, z: -0.668480,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '04153-0739-AC', comp: 'A',
        gaiaSourceId: '3195919528989223040', hip: 19849,
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 5.931, name: 'Keid', source: 'athyg',
        astrometryVia: 'gaia_5p', orbitRole: 'primary',
        sepArcsec: 77.9, paDeg: 98.0, sepPaEpochJd: 2460311.0, dmag: 6.74,
      }),
      multiplesRow({
        systemId: '04153-0739-XY', comp: 'X',
        gaiaSourceId: null, hip: null,  // no own ID
        x_pc: 2.191467, y_pc: 4.455210, z_pc: -0.668480, distPc: 5.0,
        absmag: 11.0, ci: 0.0, spect: '',
        photometryVia: 'athyg_own', name: '',
        astrometryVia: 'system_inherited', orbitRole: 'primary',
        sepArcsec: 7.7, paDeg: 327.0, sepPaEpochJd: 2460311.0, dmag: 1.0,
      }),
    ];
    const { newStars } = promoteCompanions(rows, [keid], CONSTELLATIONS);
    // No promotion for the no-ID X primary.
    expect(newStars.find(s => s.proper === 'Keid X')).toBeUndefined();
  });

  it('skips standalone-role rows (orbit_role !== "secondary")', () => {
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '07346+3153-_A', comp: 'A',
        gaiaSourceId: '999', orbitRole: 'standalone',
        absmag: 5.0,
      }),
    ];
    const { stats } = promoteCompanions(rows, [], CONSTELLATIONS);
    expect(stats.promoted).toBe(0);
    expect(stats.pairRowsScanned).toBe(0);
  });
});

describe('buildCatalogRowIndexMap', () => {
  it('indexes by gaia and hip, first occurrence wins on collision', () => {
    const stars: Star[] = [
      makeStar({ gaiaSourceId: 'g1', hip: 100 }),
      makeStar({ gaiaSourceId: 'g2', hip: 100 }),  // hip collision
      makeStar({ gaiaSourceId: null, hip: 101 }),
    ];
    const map = buildCatalogRowIndexMap(stars);
    expect(map.byGaia.g1).toBe(0);
    expect(map.byGaia.g2).toBe(1);
    expect(map.byHip['100']).toBe(0);  // first occurrence
    expect(map.byHip['101']).toBe(2);
  });

  it('omits records with no gaia and no hip', () => {
    const stars: Star[] = [makeStar(), makeStar({ gaiaSourceId: 'g1' })];
    const map = buildCatalogRowIndexMap(stars);
    expect(Object.keys(map.byGaia)).toEqual(['g1']);
    expect(Object.keys(map.byHip)).toHaveLength(0);
    expect(Object.keys(map.bySynth)).toHaveLength(0);
  });

  it('indexes synthetic-ID records into bySynth', () => {
    const stars: Star[] = [
      makeStar({ gaiaSourceId: 'g1', hip: 100 }),
      makeStar({ syntheticId: 'synth-03082+4057-Ab' }),
      makeStar({ syntheticId: 'synth-03082+4057-Aa2' }),
    ];
    const map = buildCatalogRowIndexMap(stars);
    expect(map.bySynth['synth-03082+4057-Ab']).toBe(1);
    expect(map.bySynth['synth-03082+4057-Aa2']).toBe(2);
    // Synthetic-only records carry no gaia/hip key.
    expect(Object.keys(map.byGaia)).toEqual(['g1']);
    expect(Object.keys(map.byHip)).toEqual(['100']);
  });
});

describe('composeSyntheticId', () => {
  it('builds "synth-<wds_id>-<comp>" from a Stage 6 system_id', () => {
    expect(composeSyntheticId('03082+4057-Aa,Ab', 'Ab')).toBe('synth-03082+4057-Ab');
  });

  it('preserves negative-Dec wds_id intact', () => {
    expect(composeSyntheticId('16120-1928-Aa,Ab', 'Ab')).toBe('synth-16120-1928-Ab');
  });

  it('returns null for empty comp letter', () => {
    expect(composeSyntheticId('03082+4057-Aa,Ab', '')).toBeNull();
    expect(composeSyntheticId('03082+4057-Aa,Ab', '   ')).toBeNull();
  });

  it('returns null when system_id has no dash (malformed)', () => {
    expect(composeSyntheticId('NODASH', 'Ab')).toBeNull();
  });
});

describe('canonicalCompLetter', () => {
  it('re-anchors WDS prefix-truncated bare-digit secondary onto primary stem', () => {
    // Algol Aa1,2 — secondary cell carries "2" not "Aa2".
    expect(canonicalCompLetter('Aa1', '2')).toBe('Aa2');
  });

  it('passes through non-digit secondary unchanged', () => {
    expect(canonicalCompLetter('A', 'B')).toBe('B');
    expect(canonicalCompLetter('Aa', 'Ab')).toBe('Ab');
  });

  it('passes through when primary has no trailing digit', () => {
    expect(canonicalCompLetter('AB', '2')).toBe('2');
  });

  it('passes through for single-character primary (no stem to extract)', () => {
    expect(canonicalCompLetter('A', '2')).toBe('2');
  });
});

describe('parentComponentToken', () => {
  // Fixtures mirror component_tokens.py:test_parent_component_token so
  // the Python↔TS mirror can't silently drift.
  it('drops the rightmost designator', () => {
    expect(parentComponentToken('Aa1')).toBe('Aa');
    expect(parentComponentToken('Ba')).toBe('B');
    expect(parentComponentToken('Aa')).toBe('A');
  });

  it('returns null for a single-character (top-level) token', () => {
    expect(parentComponentToken('A')).toBeNull();
  });
});

describe('stampComponentLetters', () => {
  const cygIndex = CONSTELLATIONS.findIndex((c) => c.code === 'Cyg');

  function cygRows(): MultiplesTsvRow[] {
    return [
      multiplesRow({
        systemId: '21069+3845-AB', comp: 'A',
        hip: 104214, gaiaSourceId: '1872046609345556480',
        source: 'athyg', name: '', orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '21069+3845-AB', comp: 'B',
        hip: 104217, gaiaSourceId: '1872046574983497216',
        source: 'athyg', name: '', orbitRole: 'secondary',
      }),
    ];
  }

  it('stamps A/B onto anonymous first-class AT-HYG pair rows (61 Cyg)', () => {
    const a = makeStar({
      hip: 104214, gaiaSourceId: '1872046609345556480',
      proper: null, bayer: null, flam: 61, conIndex: cygIndex, absmag: 7.482,
    });
    const b = makeStar({
      hip: 104217, gaiaSourceId: '1872046574983497216',
      proper: null, bayer: null, flam: 61, conIndex: cygIndex, absmag: 8.332,
    });
    const stars = [a, b];
    const stats = stampComponentLetters(groupBySystem(cygRows()), stars, CONSTELLATIONS);
    expect(stats.systemsStamped).toBe(1);
    expect(stats.rowsStamped).toBe(2);
    expect(a.proper).toBe('61 Cyg A');
    expect(b.proper).toBe('61 Cyg B');
    expect(a.flags & FLAG_HAS_NAME).toBeTruthy();
    expect(b.flags & FLAG_HAS_NAME).toBeTruthy();
  });

  it('leaves a system alone when any component already has a proper (Sirius A stays "Sirius")', () => {
    const a = makeStar({
      hip: 104214, gaiaSourceId: '1872046609345556480',
      proper: 'Sirius', flam: 61, conIndex: cygIndex,
    });
    const b = makeStar({
      hip: 104217, gaiaSourceId: '1872046574983497216', proper: null,
    });
    const stars = [a, b];
    const stats = stampComponentLetters(groupBySystem(cygRows()), stars, CONSTELLATIONS);
    expect(stats.rowsStamped).toBe(0);
    expect(a.proper).toBe('Sirius');
    expect(b.proper).toBeNull();
  });

  it('skips when the primary yields no usable name base (no Bayer/Flamsteed)', () => {
    const a = makeStar({
      hip: 104214, gaiaSourceId: '1872046609345556480',
      proper: null, bayer: null, flam: null, conIndex: cygIndex,
    });
    const b = makeStar({
      hip: 104217, gaiaSourceId: '1872046574983497216', proper: null,
    });
    const stars = [a, b];
    const stats = stampComponentLetters(groupBySystem(cygRows()), stars, CONSTELLATIONS);
    expect(stats.rowsStamped).toBe(0);
    expect(a.proper).toBeNull();
    expect(b.proper).toBeNull();
  });

  it('does not stamp when only one component resolves to a first-class row', () => {
    const a = makeStar({
      hip: 104214, gaiaSourceId: '1872046609345556480',
      proper: null, flam: 61, conIndex: cygIndex,
    });
    // B carries FLAG_BINARY_COMPANION_ONLY — a promoted companion, not a
    // first-class AT-HYG row, so it's excluded and the pair falls under 2.
    const b = makeStar({
      hip: 104217, gaiaSourceId: '1872046574983497216',
      proper: null, flags: FLAG_BINARY_COMPANION_ONLY,
    });
    const stars = [a, b];
    const stats = stampComponentLetters(groupBySystem(cygRows()), stars, CONSTELLATIONS);
    expect(stats.rowsStamped).toBe(0);
    expect(a.proper).toBeNull();
  });

  it('does not stamp a blended single entry whose components share one identifier', () => {
    // AT-HYG carries the pair as ONE record; both multiples rows resolve to
    // it (B has no own gaia and shares A's HIP). It is one star, not two
    // components — must not be renamed "51 Psc B" (its faint secondary).
    const blend = makeStar({
      hip: 104214, gaiaSourceId: '1872046609345556480',
      proper: null, bayer: null, flam: 61, conIndex: cygIndex,
    });
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '21069+3845-AB', comp: 'A',
        hip: 104214, gaiaSourceId: '1872046609345556480',
        source: 'athyg', name: '', orbitRole: 'primary',
      }),
      multiplesRow({
        systemId: '21069+3845-AB', comp: 'B',
        hip: 104214, gaiaSourceId: null,
        source: 'athyg', name: '', orbitRole: 'secondary',
      }),
    ];
    const stars = [blend];
    const stats = stampComponentLetters(groupBySystem(rows), stars, CONSTELLATIONS);
    expect(stats.systemsStamped).toBe(0);
    expect(stats.rowsStamped).toBe(0);
    expect(blend.proper).toBeNull();
  });
});

describe('wingRenderablePrimaries', () => {
  const wing = (rows: MultiplesTsvRow[], stars: Star[]) =>
    wingRenderablePrimaries(rows, stars, buildCatalogRowIndexMap(stars));
  const isWinged = (s: Star) => (s.flags & FLAG_BINARY_PRIMARY) !== 0;

  it('wings the brightest member of a physical pair with a distinct companion', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b])).toBe(1);
    expect(isWinged(a)).toBe(true);
    expect(isWinged(b)).toBe(false);
  });

  it('adds exactly one glyph per hierarchical system, on the system anchor', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0 });
    const c = makeStar({ hip: 300, absmag: 3.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
      multiplesRow({ systemId: 'W1-AC', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AC', comp: 'C', hip: 300, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b, c])).toBe(1);
    expect(isWinged(a)).toBe(true);
    expect(isWinged(b)).toBe(false);
    expect(isWinged(c)).toBe(false);
  });

  it('skips a system that a prior pass already flagged (no second glyph)', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0, flags: FLAG_BINARY_PRIMARY });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b])).toBe(0);
    expect(isWinged(a)).toBe(false);
  });

  it('resolves a blended secondary through its synth slot (id-first collides on the primary)', () => {
    // Aa and Ab share the primary's Gaia source; promotion minted a synth
    // record for Ab. id-first resolve lands on Aa, the synth retry recovers
    // the distinct companion.
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const ab = makeStar({ syntheticId: 'synth-W1-Ab', absmag: 12.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa, ab])).toBe(1);
    expect(isWinged(aa)).toBe(true);
    expect(isWinged(ab)).toBe(false);
  });

  it('canonicalises a WDS-truncated digit secondary to its synth slot', () => {
    // Stage 6 emits comp="2" for the secondary side of an "Aa1,2" pair;
    // the synth key is minted from the canonical "Aa2".
    const aa1 = makeStar({ hip: 100, absmag: 1.0 });
    const aa2 = makeStar({ syntheticId: 'synth-W1-Aa2', absmag: 8.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa1,2', comp: 'Aa1', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa1,2', comp: '2', hip: 100, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa1, aa2])).toBe(1);
    expect(isWinged(aa1)).toBe(true);
  });

  it('re-homes a blended non-anchor primary through its synth slot (secondary stays on the anchor)', () => {
    // Castor BC pattern: the pair's primary (Ca) carries the system anchor's
    // gaia, so its id-first resolve lands on the anchor; its own synth slot is
    // the true companion end. The secondary (Cb) blends onto the anchor too but
    // was never promoted (no synth). Without the primary synth retry the pair
    // reads pri == sec == anchor and the system is wrongly left unwinged.
    const anchor = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const caSynth = makeStar({ syntheticId: 'synth-W1-Ca', absmag: 5.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Ca,Cb', comp: 'Ca', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Ca,Cb', comp: 'Cb', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [anchor, caSynth])).toBe(1);
    expect(isWinged(anchor)).toBe(true);
    expect(isWinged(caSynth)).toBe(false);
  });

  it('leaves a degenerate pair (secondary collapses onto the primary, no synth slot) unwinged', () => {
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa])).toBe(0);
    expect(isWinged(aa)).toBe(false);
  });

  it('ignores standalone rows (not a side of a rendered pair)', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-_A', comp: 'A', hip: 100, orbitRole: 'standalone' }),
    ];
    expect(wing(rows, [a])).toBe(0);
    expect(isWinged(a)).toBe(false);
  });
});
