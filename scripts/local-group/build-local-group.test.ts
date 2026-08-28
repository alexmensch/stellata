// Tests for I/O-adjacent helpers in build-local-group.ts: the override
// TSV parser plus an integration test that reads the committed LVDB
// CSV and pins display-name routing for every renderable name.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { parseAliases, parseLvdb, parseOverrides } from './build-local-group';
import {
  applyAliasMeta,
  buildStandaloneOverride,
  DISPLAY_NAME_OVERRIDES,
  filterForRendering,
  isCatalogDesignation,
  mergeRowAndOverride,
  roundN,
  type LgObject,
} from './build-local-group-pure';
import { lgObjectStub } from './lg-object-mock';

describe('parseOverrides', () => {
  const HEADER =
    'name\ta_pc\tb_pc\tc_pc\torient\tref_doi\tra_deg\tdec_deg\tdistance_kpc';
  const FULL_HEADER =
    HEADER +
    '\tm_v\tprofile\tn_sersic\tr_d_pc\tbulge_to_total\tbulge_re_pc\tbulge_n\tref_doi_profile\tcolor';

  it('parses an LVDB-merge row (6 columns) with empty trailing position fields', () => {
    const tsv = `${HEADER}\nLMC\t4500\t4500\t1000\tdisc:i=32,pa=135\t10.1088/0004-637X/781/2/121\n`;
    const rows = parseOverrides(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: 'LMC',
      axes: [4500, 4500, 1000],
      orient: 'disc:i=32,pa=135',
      refDoi: '10.1088/0004-637X/781/2/121',
    });
  });

  it('parses a standalone row (9 columns) with full ra/dec/distance', () => {
    const tsv = `${HEADER}\nM31\t15000\t15000\t500\tdisc:i=77,pa=37\t10.3847/1538-4357/aae8e7\t10.6847\t41.2687\t776\n`;
    const rows = parseOverrides(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: 'M31',
      axes: [15000, 15000, 500],
      orient: 'disc:i=77,pa=37',
      refDoi: '10.3847/1538-4357/aae8e7',
      raDeg: 10.6847,
      decDeg: 41.2687,
      distanceKpc: 776,
    });
  });

  it('accepts a 9-column row with all three optional fields empty (still an LVDB-merge row)', () => {
    const tsv = `${HEADER}\nSMC\t3730\t4960\t6000\tlos\t10.1088/0004-637X/744/2/128\t\t\t\n`;
    const rows = parseOverrides(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].raDeg).toBeUndefined();
    expect(rows[0].decDeg).toBeUndefined();
    expect(rows[0].distanceKpc).toBeUndefined();
  });

  it('throws when the standalone position is partially populated', () => {
    // ra + dec set but distance empty — half-set is a config error.
    const tsv = `${HEADER}\nM31\t15000\t15000\t500\tdisc:i=77,pa=37\tx\t10.6847\t41.2687\t\n`;
    expect(() => parseOverrides(tsv)).toThrow(/partially populates/);
  });

  it('skips comment lines and blank lines', () => {
    const tsv = `# comment\n# another\n\n${HEADER}\n# inline comment\nLMC\t4500\t4500\t1000\tlos\tx\n`;
    expect(parseOverrides(tsv)).toHaveLength(1);
  });

  it('throws on a malformed header (wrong column order or missing required columns)', () => {
    expect(() => parseOverrides('name\tfoo\tbar\n')).toThrow(/malformed header/);
    expect(() =>
      parseOverrides('name\ta_pc\tb_pc\tc_pc\torient\twrong\n'),
    ).toThrow(/header column/);
  });

  it('parses the emission columns by header name (LMC-shaped disc row)', () => {
    const tsv = `${FULL_HEADER}\nLMC\t4500\t4500\t1000\tdisc:i=32,pa=135\tx\t\t\t\t\tdisc\t\t1500\t\t\t\t10.1086/323099\t\n`;
    const rows = parseOverrides(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].profile).toBe('disc');
    expect(rows[0].rdPc).toBe(1500);
    expect(rows[0].refDoiProfile).toBe('10.1086/323099');
    expect(rows[0].mV).toBeUndefined();
    expect(rows[0].nSersic).toBeUndefined();
    expect(rows[0].bulgeToTotal).toBeUndefined();
    expect(rows[0].color).toBeUndefined();
  });

  it('parses a full standalone disc+bulge row (M31-shaped)', () => {
    const tsv = `${FULL_HEADER}\nM31\t15000\t15000\t500\tdisc:i=77,pa=37\tx\t10.6847\t41.2687\t776\t3.44\tdisc\t\t5300\t0.31\t1000\t2.2\ty\t#ffd9b0\n`;
    const rows = parseOverrides(tsv);
    expect(rows[0].mV).toBe(3.44);
    expect(rows[0].profile).toBe('disc');
    expect(rows[0].rdPc).toBe(5300);
    expect(rows[0].bulgeToTotal).toBe(0.31);
    expect(rows[0].bulgeRePc).toBe(1000);
    expect(rows[0].bulgeN).toBe(2.2);
    expect(rows[0].color).toBe('#ffd9b0');
  });

  it('throws when the bulge trio is partially populated', () => {
    const tsv = `${FULL_HEADER}\nM31\t15000\t15000\t500\tdisc:i=77,pa=37\tx\t10.6847\t41.2687\t776\t3.44\tdisc\t\t5300\t0.31\t\t\t\t\n`;
    expect(() => parseOverrides(tsv)).toThrow(/partially populates the bulge/);
  });

  it('throws on an unrecognised profile value', () => {
    const tsv = `${FULL_HEADER}\nX\t1\t1\t1\tlos\tx\t\t\t\t\tspiral\t\t\t\t\t\t\t\n`;
    expect(() => parseOverrides(tsv)).toThrow(/unrecognised profile 'spiral'/);
  });

  it('throws on a non-numeric value in a numeric emission column', () => {
    const tsv = `${FULL_HEADER}\nX\t1\t1\t1\tlos\tx\t\t\t\tbright\t\t\t\t\t\t\t\t\n`;
    expect(() => parseOverrides(tsv)).toThrow(/non-numeric m_v 'bright'/);
  });
});

describe('LVDB-band display-name coverage', () => {
  // Read the committed LVDB snapshot at test time so a future refresh
  // that introduces a name the renderer would mis-suffix surfaces here
  // rather than only at build-output review time. Reading committed
  // data follows the pattern in src/client/stellata-events.test.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  const csvPath = join(here, '..', '..', 'data', 'local-group', 'lvdb-snapshot.csv');
  const lvdb = parseLvdb(readFileSync(csvPath, 'utf8'));
  const renderable = filterForRendering(lvdb);

  // Every renderable name that legitimately falls to the default
  // "X Dwarf Spheroidal" branch — i.e. names that are genuinely dSphs
  // in the current snapshot. Names not on this list (and not catalog
  // designations or override-map entries) trip the assertion below so
  // we can decide between (a) adding a DISPLAY_NAME_OVERRIDES entry
  // because the name isn't a dSph, (b) confirming the dSph reading
  // and adding the name here. Refresh this set whenever the LVDB
  // snapshot under data/local-group/ rolls forward (manual; per
  // `frozen-external-data`).
  const KNOWN_DSPH_NAMES = new Set([
    'Andromeda I', 'Andromeda II', 'Andromeda III', 'Andromeda IX',
    'Andromeda V', 'Andromeda VI', 'Andromeda VII', 'Andromeda X',
    'Andromeda XI', 'Andromeda XII', 'Andromeda XIII', 'Andromeda XIV',
    'Andromeda XIX', 'Andromeda XV', 'Andromeda XVI', 'Andromeda XVII',
    'Andromeda XVIII', 'Andromeda XX', 'Andromeda XXI', 'Andromeda XXII',
    'Andromeda XXIII', 'Andromeda XXIV', 'Andromeda XXIX', 'Andromeda XXV',
    'Andromeda XXVI', 'Andromeda XXVII', 'Andromeda XXVIII', 'Andromeda XXXV',
    'Antlia', 'Antlia II', 'Aquarius II', 'Aquarius III',
    'Bootes I', 'Bootes II', 'Bootes III',
    'Canes Venatici I', 'Canes Venatici II',
    'Carina', 'Carina II', 'Carina III', 'Carina IV',
    'Cassiopeia II', 'Cassiopeia III', 'Centaurus I',
    'Cetus', 'Columba I', 'Coma Berenices', 'Crater II',
    'Draco', 'Draco II',
    'Eridanus II', 'Eridanus IV',
    'Fornax', 'Grus I', 'Grus II',
    'Hercules', 'Horologium I', 'Hydra II', 'Hydrus I',
    'Lacerta I',
    'Leo I', 'Leo II', 'Leo IV', 'Leo K', 'Leo M', 'Leo T', 'Leo V', 'Leo VI',
    'Pegasus III', 'Pegasus IV', 'Pegasus V', 'Pegasus VII',
    'Perseus I', 'Phoenix II', 'Pictor II',
    'Pisces II', 'Pisces VII',
    'Reticulum II', 'Reticulum III',
    'Sagittarius', 'Sculptor', 'Segue 1', 'Segue 2', 'Sextans',
    'Triangulum II',
    'Tucana', 'Tucana B', 'Tucana II', 'Tucana IV', 'Tucana V',
    'Ursa Major I', 'Ursa Major II', 'Ursa Minor', 'Willman 1',
  ]);

  it('every renderable name routes through a known display-name branch', () => {
    const unclassified: string[] = [];
    for (const row of renderable) {
      const n = row.name;
      if (n in DISPLAY_NAME_OVERRIDES) continue;
      if (isCatalogDesignation(n)) continue;
      if (!KNOWN_DSPH_NAMES.has(n)) unclassified.push(n);
    }
    // A non-empty list here means LVDB has a new name we haven't
    // classified; review its morphology and either add to
    // DISPLAY_NAME_OVERRIDES (if non-dSph) or to KNOWN_DSPH_NAMES.
    expect(unclassified).toEqual([]);
  });

  it('KNOWN_DSPH_NAMES has no stale entries — every name appears in the current LVDB band', () => {
    const renderableNames = new Set(renderable.map((r) => r.name));
    const stale = [...KNOWN_DSPH_NAMES].filter((n) => !renderableNames.has(n));
    expect(stale).toEqual([]);
  });

  it('override-map entries are all present in the current LVDB band (no orphaned overrides)', () => {
    // DISPLAY_NAME_OVERRIDES is the named-non-dSph map; M31 / M33 ride
    // through the catalog-designation regex, not this map, so every
    // entry here must correspond to an actual LVDB row.
    const renderableNames = new Set(renderable.map((r) => r.name));
    const orphaned = Object.keys(DISPLAY_NAME_OVERRIDES).filter(
      (n) => !renderableNames.has(n),
    );
    expect(orphaned).toEqual([]);
  });
});

describe('emission over the committed catalog', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, '..', '..', 'data', 'local-group');
  const csvText = readFileSync(join(dataDir, 'lvdb-snapshot.csv'), 'utf8');
  const lvdb = parseLvdb(csvText);
  const overrides = parseOverrides(readFileSync(join(dataDir, 'overrides.tsv'), 'utf8'));
  const overrideByName = new Map(overrides.map((o) => [o.name, o]));
  const renderable = filterForRendering(lvdb);

  const objects: LgObject[] = [];
  for (const row of renderable) {
    const merged = mergeRowAndOverride(row, overrideByName.get(row.name));
    if (merged) objects.push(merged);
  }
  const matched = new Set(objects.map((o) => o.name));
  for (const ov of overrides) {
    if (matched.has(ov.name) || renderable.some((r) => r.name === ov.name)) continue;
    const built = buildStandaloneOverride(ov);
    if (built) objects.push(built);
  }
  const byName = new Map(objects.map((o) => [o.name, o]));

  it('every rendered object solves to a positive finite density0', () => {
    expect(objects.length).toBe(123);
    for (const o of objects) {
      expect(Number.isFinite(o.emission.density0)).toBe(true);
      expect(o.emission.density0).toBeGreaterThan(0);
      if (o.emission.family === 'disc' && o.emission.bulge) {
        expect(o.emission.bulge.density0).toBeGreaterThan(0);
      }
    }
  });

  it('routes exactly LMC / M31 / M33 to the disc family', () => {
    const discs = objects
      .filter((o) => o.emission.family === 'disc')
      .map((o) => o.name)
      .sort();
    expect(discs).toEqual(['Large Magellanic Cloud', 'M31', 'M33']);
  });

  it('pins the LMC disc solve', () => {
    const e = byName.get('Large Magellanic Cloud')!.emission;
    if (e.family !== 'disc') throw new Error('expected disc');
    expect(e.mV).toBe(0.4);
    expect(e.rdPc).toBe(1500);
    expect(e.zdPc).toBe(1000 / 3);
    expect(e.rEnvPc).toBe(6000);
    expect(e.zEnvPc).toBe(4000 / 3);
    expect(e.density0).toBe(0.20821438024760253);
  });

  it('pins the SMC rescaled-shell spheroid solve', () => {
    const e = byName.get('Small Magellanic Cloud')!.emission;
    if (e.family !== 'sersic') throw new Error('expected sersic');
    expect(e.mV).toBe(2.2);
    expect(e.n).toBe(1);
    expect(e.reffAxesPc.map((v) => roundN(v, 2))).toEqual([812.82, 1080.85, 1307.48]);
    expect(roundN(e.uMax, 4)).toBe(4.589);
    expect(e.density0).toBe(0.09850365183085676);
  });

  it('pins the M31 disc + bulge composite solve', () => {
    const e = byName.get('M31')!.emission;
    if (e.family !== 'disc') throw new Error('expected disc');
    expect(e.mV).toBe(3.44);
    expect(e.density0).toBe(0.34273291272719336);
    expect(e.bulge!.n).toBe(2.2);
    expect(e.bulge!.density0).toBe(13.392310279896599);
  });

  it('pins a default-path dwarf solve (Fornax)', () => {
    const e = byName.get('Fornax Dwarf Spheroidal')!.emission;
    if (e.family !== 'sersic') throw new Error('expected sersic');
    expect(e.mV).toBe(7.377);
    expect(e.n).toBe(1);
    expect(e.density0).toBe(0.01749206558610738);
  });

  it('⟨μ⟩_e = m_V + 0.753 + 2.5·log10(π·a·b) reproduces LVDB surface_brightness_rhalf', () => {
    // Definitional consistency between the three fields the emission
    // calibration consumes (m_V, rhalf, ellipticity) and LVDB's own
    // derived mean surface brightness — a data-sanity check on the
    // committed snapshot, not a new physical constraint.
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
    const byKey = new Map(records.map((r) => [r.key, r]));
    const devs: number[] = [];
    let worstName = '';
    let worstDev = 0;
    for (const row of renderable) {
      const raw = byKey.get(row.key)!;
      if (raw.apparent_magnitude_v === '' || raw.rhalf === '' || raw.surface_brightness_rhalf === '') continue;
      const mv = Number(raw.apparent_magnitude_v);
      const aArcsec = Number(raw.rhalf) * 60;
      const e = raw.ellipticity === '' ? 0 : Number(raw.ellipticity);
      const mu = mv + 0.753 + 2.5 * Math.log10(Math.PI * aArcsec * aArcsec * (1 - e));
      const dev = mu - Number(raw.surface_brightness_rhalf);
      devs.push(Math.abs(dev));
      if (Math.abs(dev) > Math.abs(worstDev)) {
        worstDev = dev;
        worstName = row.name;
      }
    }
    devs.sort((x, y) => x - y);
    expect(devs.length).toBe(121);
    expect(roundN(devs[Math.floor(devs.length / 2)], 4)).toBe(0.0078);
    expect(roundN(worstDev, 4)).toBe(0.2504);
    expect(worstName).toBe('Andromeda XX');
  });
});

describe('parseAliases + type/alias plumbing', () => {
  const HEADER = 'name\ttype\taliases\tcanonical\n';

  it('parses rows, splitting the |-separated alias list', () => {
    const tsv = `${HEADER}M31\tSpiral galaxy\tAndromeda Galaxy|NGC 224\nFornax\tDwarf spheroidal\t\n`;
    expect(parseAliases(tsv)).toEqual([
      { name: 'M31', type: 'Spiral galaxy', aliases: ['Andromeda Galaxy', 'NGC 224'] },
      { name: 'Fornax', type: 'Dwarf spheroidal', aliases: [] },
    ]);
  });
  it('reads the canonical promotion, and omits the key when the column is blank', () => {
    const tsv = `${HEADER}M31\tSpiral galaxy\tAndromeda Galaxy|NGC 224\tAndromeda Galaxy\n`;
    expect(parseAliases(tsv)[0].canonical).toBe('Andromeda Galaxy');
    expect(parseAliases(`${HEADER}M31\tSpiral galaxy\tNGC 224\t\n`)[0])
      .not.toHaveProperty('canonical');
  });
  it('throws on a malformed header or empty type', () => {
    expect(() => parseAliases('name\twrong\taliases\tcanonical\nX\tY\t\n'))
      .toThrow(/malformed header/);
    // The pre-canonical 3-column header no longer parses — a stale TSV
    // would silently ship un-promoted names.
    expect(() => parseAliases('name\ttype\taliases\nX\tY\t\n')).toThrow(/malformed header/);
    expect(() => parseAliases(`${HEADER}X\t\t\n`)).toThrow(/empty type/);
  });
  it('throws when a promotion names a designation the row does not list', () => {
    expect(() => parseAliases(`${HEADER}M31\tSpiral galaxy\tNGC 224\tAndromeda Galaxy\n`))
      .toThrow(/not one of its aliases/);
  });
  it('normalises designations on the way in, so column spellings need not match', () => {
    const rows = parseAliases(`${HEADER}NGC 205\tDwarf elliptical\tMessier 110|NGC221\tM 110\n`);
    expect(rows[0].aliases).toEqual(['M110', 'NGC 221']);
    expect(rows[0].canonical).toBe('M110');
  });
  it('curated rows all match rendered objects (no orphans in the committed TSV)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const aliasRows = parseAliases(
      readFileSync(join(here, '..', '..', 'data', 'local-group', 'aliases.tsv'), 'utf8'),
    );
    const csvPath = join(here, '..', '..', 'data', 'local-group', 'lvdb-snapshot.csv');
    const names = new Set(
      filterForRendering(parseLvdb(readFileSync(csvPath, 'utf8'))).map((r) => r.name),
    );
    names.add('M31');
    names.add('M33');
    const orphans = aliasRows.filter((a) => !names.has(a.name));
    expect(orphans).toEqual([]);
    expect(aliasRows.length).toBe(27);
  });
  it('the committed promotions resolve to their proper names + conventional aliases', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const rows = parseAliases(
      readFileSync(join(here, '..', '..', 'data', 'local-group', 'aliases.tsv'), 'utf8'),
    );
    const promoted = (key: string, derived: string) => {
      const row = rows.find((r) => r.name === key);
      if (!row) throw new Error(`no aliases.tsv row for '${key}'`);
      const obj = applyAliasMeta(lgObjectStub(derived), row);
      return [obj.name, obj.aliases];
    };
    expect(promoted('M31', 'M31')).toEqual(['Andromeda Galaxy', ['M31', 'NGC 224']]);
    expect(promoted('M33', 'M33')).toEqual(['Triangulum Galaxy', ['M33', 'NGC 598']]);
    expect(promoted('NGC 6822', 'NGC 6822'))
      .toEqual(["Barnard's Galaxy", ['NGC 6822', 'IC 4895']]);
    expect(promoted('WLM', 'WLM'))
      .toEqual(['Wolf-Lundmark-Melotte', ['WLM', 'DDO 221', 'UGCA 444']]);
    expect(promoted('LGS 3', 'LGS 3')).toEqual(['Pisces Dwarf', ['LGS 3', 'Pisces I']]);
    // No proper name in play — the Messier-over-NGC rung decides.
    expect(promoted('NGC 205', 'NGC 205')).toEqual(['M110', ['NGC 205']]);
    expect(rows.filter((r) => r.canonical).length).toBe(6);
  });
});
