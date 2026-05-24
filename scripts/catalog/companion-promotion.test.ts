import { describe, it, expect } from 'vitest';
import {
  buildCatalogRowIndexMap,
  imputeCompanionAbsmag,
  imputeCompanionCi,
  parseMultiplesTsv,
  projectFromSepPa,
  promoteCompanions,
  type MultiplesTsvRow,
} from './companion-promotion';
import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_HAS_NAME,
  SOLAR_BV_FALLBACK,
  SPECTRAL_UNKNOWN,
  classifyFromSimbad,
} from './catalog-pure';
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
    athygDist: null,
    athygDistSrc: null,
    ...overrides,
  };
}

function multiplesRow(overrides: Partial<MultiplesTsvRow> = {}): MultiplesTsvRow {
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
    orbitRole: 'secondary',
    distPc: 100,
    sepArcsec: null,
    paDeg: null,
    sepPaEpochJd: null,
    dmag: null,
    ...overrides,
  };
}

describe('parseMultiplesTsv', () => {
  it('parses a minimal header + one row', () => {
    const header = [
      'system_id','comp','hip','gaia_source_id',
      'x_pc','y_pc','z_pc','absmag','ci','spect','name',
      'source','regime','resolve_via','astrometry_via','orbit_via',
      'spect_via','orbit_role',
      'P_days','T_jd','e','a_AU','i_rad','omega_rad','Omega_rad',
      'q','dist_pc',
      'sep_arcsec','pa_deg','sep_pa_epoch_jd','dmag',
    ].join('\t');
    const body = [
      'WDS-X-AB','A','12345','1234567890123456',
      '1.0','2.0','3.0','5.50','0.45','G2V','Sirius',
      'athyg','2','orb6_hip','gaia_5p','orb6',
      'simbad','primary',
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
      'spect_via','orbit_role',
      'P_days','T_jd','e','a_AU','i_rad','omega_rad','Omega_rad',
      'q','dist_pc',
      'sep_arcsec','pa_deg','sep_pa_epoch_jd','dmag',
    ].join('\t');
    const body = [
      'WDS-X-AB','B','','',
      '','','','','','','',
      'wds','0','unresolved','unresolved','none',
      'none','secondary',
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

  it('imputes from primary + Δmag when secondary inherited the primary absmag', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: 1.45, dmag: 9.91,
    });
    expect(imputeCompanionAbsmag(sec, primary)).toBeCloseTo(11.36, 4);
  });

  it('uses the secondary own absmag when it differs from primary', () => {
    const sec = multiplesRow({ comp: 'B', absmag: 11.18, dmag: 9.7 });
    expect(imputeCompanionAbsmag(sec, primary)).toBe(11.18);
  });

  it('falls through to primary + Δmag when secondary absmag is null', () => {
    const sec = multiplesRow({ comp: 'B', absmag: null, dmag: 9.91 });
    expect(imputeCompanionAbsmag(sec, primary)).toBeCloseTo(11.36, 4);
  });

  it('returns null when no path can produce an absmag', () => {
    const sec = multiplesRow({ comp: 'B', absmag: null, dmag: null });
    expect(imputeCompanionAbsmag(sec, primary)).toBeNull();
  });
});

describe('imputeCompanionCi', () => {
  const primary = multiplesRow({ orbitRole: 'primary', comp: 'A', ci: 0.009 });
  const wdInfo = classifyFromSimbad('DA1.9')!;
  const mDwarfInfo = classifyFromSimbad('M3V')!;

  it('derives a hot-WD B-V from the WD subclass when ci is inherited', () => {
    const sec = multiplesRow({ comp: 'B', ci: 0.009 });
    const bv = imputeCompanionCi(sec, primary, wdInfo);
    // T_eff(DA1.9) = 50400/2 = 25200 K → Ballesteros⁻¹ ≈ -0.44.
    // The shader's LUT clamps to BV_MIN=-0.4 at lookup time; we store
    // the unclamped value so the raw temperature stays recoverable.
    expect(bv).toBeLessThan(-0.4);
    expect(bv).toBeGreaterThan(-0.5);
  });

  it('uses row.ci when the secondary carries a per-component value distinct from the primary', () => {
    const sec = multiplesRow({ comp: 'B', ci: 1.42 });
    expect(imputeCompanionCi(sec, primary, mDwarfInfo)).toBe(1.42);
  });

  it('derives from spectral info when row.ci is null', () => {
    const sec = multiplesRow({ comp: 'B', ci: null });
    const bv = imputeCompanionCi(sec, primary, mDwarfInfo);
    expect(bv).toBeGreaterThan(0.5);
    expect(bv).toBeLessThan(2.0);
  });

  it('falls through to SOLAR_BV_FALLBACK for unparseable spectral info', () => {
    const sec = multiplesRow({ comp: 'B', ci: 0.009 });
    expect(imputeCompanionCi(sec, primary, SPECTRAL_UNKNOWN)).toBe(SOLAR_BV_FALLBACK);
  });

  it('falls through to SOLAR_BV_FALLBACK when spectral classIdx is 8 and not a WD', () => {
    // A SIMBAD-Gaia-saturated row with parseable lumClass but
    // classIdx=8 (the "other / unknown" bucket) carries no
    // temperature anchor → don't trust the 5000 K default.
    const sec = multiplesRow({ comp: 'B', ci: null });
    const unknownButLumClass = { ...SPECTRAL_UNKNOWN, lumClass: 2 };
    expect(imputeCompanionCi(sec, primary, unknownButLumClass)).toBe(SOLAR_BV_FALLBACK);
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
        orbitRole: 'secondary',
        sepArcsec: 11.1, paDeg: 59.0, sepPaEpochJd: 2460311.0,
        dmag: 9.91,
      }),
    ];
  }

  it('promotes Sirius B with imputed absmag, FLAG_BINARY_COMPANION_ONLY, "Sirius B" name', () => {
    const { newStars, stats } = promoteCompanions(siriusRows(), [sirius_a_existing]);
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

  it('skips secondaries already in the catalog (matched by gaia)', () => {
    const rows = siriusRows();
    const existing = makeStar({
      gaiaSourceId: '2947050466531873024', hip: 32349, absmag: 11.18,
    });
    const { newStars, stats } = promoteCompanions(rows, [existing, sirius_a_existing]);
    expect(stats.promoted).toBe(0);
    expect(stats.alreadyInCatalog).toBe(1);
    expect(newStars).toHaveLength(0);
  });

  it('drops secondaries with no identifier (gaia + hip both blank)', () => {
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;
    rows[1].hip = null;
    const { stats } = promoteCompanions(rows, [sirius_a_existing]);
    expect(stats.droppedNoIdentifier).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('promotes a no-gaia secondary whose HIP was inherited from the primary (findExisting escape)', () => {
    // Hypothetical: Stage 2 returned `unresolved` for B so the secondary
    // carries no gaia, but multiples.tsv inherited the system primary's
    // HIP from AT-HYG. findExisting would match the primary's catalog
    // record via HIP fall-through — the inherited-HIP escape lets
    // promotion proceed anyway.
    const rows = siriusRows();
    rows[1].gaiaSourceId = null;       // strip B's distinct gaia
    rows[1].hip = 32349;               // still shares primary's HIP
    rows[1].astrometryVia = 'system_inherited';
    const { newStars, stats } = promoteCompanions(rows, [sirius_a_existing]);
    expect(stats.alreadyInCatalog).toBe(0);
    expect(stats.promoted).toBe(1);
    expect(newStars).toHaveLength(1);
    // The HIP-inheritance gate elsewhere strips the inherited HIP so the
    // promoted record doesn't collide with the primary in HIP lookups.
    expect(newStars[0].hip).toBeNull();
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
    const { stats } = promoteCompanions(rows, [sirius_a_existing, otherStar]);
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
    const { stats } = promoteCompanions(rows, [sirius_a_existing]);
    expect(stats.droppedNoAbsmag).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('projects secondary position from sep+PA when astrometry is system_inherited', () => {
    const rows = siriusRows();
    rows[1].astrometryVia = 'system_inherited';
    const { newStars } = promoteCompanions(rows, [sirius_a_existing]);
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
    const { newStars } = promoteCompanions(rows, [sirius_a_existing]);
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
    const { newStars } = promoteCompanions(rows, [sirius_a_existing]);
    expect(newStars).toHaveLength(1);
    const b = newStars[0];
    const dx = b.x - sirius_a_existing.x;
    const dy = b.y - sirius_a_existing.y;
    const dz = b.z - sirius_a_existing.z;
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(sep).toBeGreaterThan(0);
    expect(sep).toBeLessThan(1e-3);
  });

  it('drops a secondary when astrometry is system_inherited but sep+PA are missing', () => {
    const rows = siriusRows();
    rows[1].astrometryVia = 'system_inherited';
    rows[1].sepArcsec = null;
    rows[1].paDeg = null;
    const { stats } = promoteCompanions(rows, [sirius_a_existing]);
    expect(stats.droppedNoPosition).toBe(1);
    expect(stats.promoted).toBe(0);
  });

  it('skips standalone-role rows (orbit_role !== "secondary")', () => {
    const rows: MultiplesTsvRow[] = [
      multiplesRow({
        systemId: '07346+3153-_A', comp: 'A',
        gaiaSourceId: '999', orbitRole: 'standalone',
        absmag: 5.0,
      }),
    ];
    const { stats } = promoteCompanions(rows, []);
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
  });
});
