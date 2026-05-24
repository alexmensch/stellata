import { describe, it, expect } from 'vitest';
import {
  buildCatalogRowIndexMap,
  imputeCompanionAbsmag,
  parseMultiplesTsv,
  projectFromSepPa,
  promoteCompanions,
  type MultiplesTsvRow,
} from './companion-promotion';
import { FLAG_BINARY_COMPANION_ONLY, FLAG_HAS_NAME } from './catalog-pure';
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
        x_pc: -0.494, y_pc: 2.477, z_pc: -0.758, distPc: 2.637,
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
        x_pc: -0.494, y_pc: 2.477, z_pc: -0.758, distPc: 2.637,
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
    expect(b.flags & FLAG_BINARY_COMPANION_ONLY).toBeTruthy();
    expect(b.flags & FLAG_HAS_NAME).toBeTruthy();
    // White dwarf parsing: classifyFromSimbad("DA1.9") → classIdx=8 (the
    // "other / white dwarf" bucket), lumClass=0 (D).
    expect(b.spectClass).toBe(8);
    expect(b.lumClass).toBe(0);
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
