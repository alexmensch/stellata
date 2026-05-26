import { describe, it, expect } from 'vitest';
import {
  buildCatalogRowIndexMap,
  canonicalCompLetter,
  composeSyntheticId,
  imputeCompanionAbsmag,
  imputeCompanionCi,
  parseMultiplesTsv,
  projectFromSepPa,
  promoteCompanions,
  type MultiplesTsvRow,
} from './companion-promotion';
import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  FLAG_HAS_NAME,
  SOLAR_BV_FALLBACK,
  SPECTRAL_UNKNOWN,
  classifyFromSimbad,
} from './catalog-pure';
import { CONSTELLATIONS } from './constellations';
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
    photometryVia: 'athyg_own',
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
    expect(imputeCompanionAbsmag(sec, primary)).toBeCloseTo(11.36, 4);
  });

  it('uses the secondary own absmag when photometry is its own', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: 11.18, dmag: 9.7,
      photometryVia: 'athyg_own',
    });
    expect(imputeCompanionAbsmag(sec, primary)).toBe(11.18);
  });

  it('falls through to primary + Δmag when secondary absmag is null', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: null, dmag: 9.91,
      photometryVia: 'none',
    });
    expect(imputeCompanionAbsmag(sec, primary)).toBeCloseTo(11.36, 4);
  });

  it('returns null when no path can produce an absmag', () => {
    const sec = multiplesRow({
      comp: 'B', absmag: null, dmag: null,
      photometryVia: 'none',
    });
    expect(imputeCompanionAbsmag(sec, primary)).toBeNull();
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

  it('promotes a pair-row primary that never appears as a secondary (40 Eri B class)', () => {
    // 40 Eri's WDS rows: A,BC has A primary + BC compound secondary
    // (dropped, no ID); AC has A primary + C secondary (C promoted);
    // BC has B primary + C secondary (B is a pair-row primary that
    // never appears as a secondary in any cursor). Without the
    // pair-row-primary escape, B never gets promoted and the BC
    // orbital pair can't resolve in build-runtime-binaries.
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
    ];
    const { newStars, stats } = promoteCompanions(rows, [keid], CONSTELLATIONS);
    // Both C (via AC group) AND B (via BC group's pair-row-primary escape)
    // get promoted. C in the BC group is skipped — already promoted.
    expect(stats.promoted).toBe(2);
    expect(newStars).toHaveLength(2);
    const byGaia = new Map(newStars.map(s => [s.gaiaSourceId, s]));
    const b = byGaia.get('3195919254111315712');
    const c = byGaia.get('3195919254111314816');
    expect(b, 'B promoted').toBeDefined();
    expect(c, 'C promoted').toBeDefined();
    if (!b || !c) return;
    expect(b.proper).toBe('Keid B');
    expect(c.proper).toBe('Keid C');
    // B sits at the WDS-root anchor (Keid's xyz) — sep+PA from the AB
    // pair isn't available in 40 Eri's WDS rows, so collocation on the
    // anchor is the best static position; BinaryOrbitField overlays
    // orbital motion at runtime.
    expect(b.x).toBeCloseTo(keid.x, 6);
    expect(b.y).toBeCloseTo(keid.y, 6);
    expect(b.z).toBeCloseTo(keid.z, 6);
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
    const dxAuFromKeid = Math.hypot(
      b.x - keid.x, b.y - keid.y, b.z - keid.z,
    ) * 206264.806;  // pc → AU at 1 pc, scaled by Keid's distance
    // 83.2″ at Keid's distance (~5 pc) projects to ~416 AU separation.
    expect(dxAuFromKeid).toBeGreaterThan(300);
    expect(dxAuFromKeid).toBeLessThan(500);
  });

  it('reuses a freshly-promoted pair-row primary as the anchor for later sub-pair groups', () => {
    // 40 Eri's BD group has B as primary again. By the time we reach
    // BD, B was promoted in BC. The BD secondary D must find B via the
    // promoted-record lookup (otherwise D would also need the
    // pair-row-primary escape, which doesn't apply to D since D never
    // appears as a primary).
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
