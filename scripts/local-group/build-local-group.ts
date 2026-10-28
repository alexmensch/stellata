// Build the Local Group catalog consumed by the client wireframe
// layer. See scripts/local-group/README.md for inputs, output schema,
// idempotency, and the LVDB-refresh protocol.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

import { emitArtifacts, runStep, sweepStaged } from '../util/emit-artifacts';
import { readTable, type TableRow, type TableSpec } from '../util/tsv/table-pure';
import { LOCAL_GROUP_OUTPUTS } from './local-group-outputs';
import {
  applyAliasMeta,
  buildOrientationQuat,
  buildStandaloneOverride,
  canonicalDesignation,
  filterForRendering,
  mergeRowAndOverride,
  roundN,
  roundSig,
  type AliasRow,
  type LgEmission,
  type LgObject,
  type LvdbRow,
  type OverrideRow,
  type SersicParams,
} from './build-local-group-pure';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

const SRC_CSV = resolve(ROOT, 'data/local-group/lvdb-snapshot.csv');
const SRC_OVERRIDES = resolve(ROOT, 'data/local-group/overrides.tsv');
const SRC_ALIASES = resolve(ROOT, 'data/local-group/aliases.tsv');
const OUT = LOCAL_GROUP_OUTPUTS.files.localGroup;

/** Coerces strings to numbers / null per LVDB convention ("" = missing
 *  for numeric cols). */
export function parseLvdb(csv: string): LvdbRow[] {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const num = (s: string | undefined): number | null => {
    if (s === undefined || s === '') return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  const int = (s: string | undefined): number => {
    const v = num(s);
    return v === null ? 0 : v;
  };

  return records.map((r) => ({
    key: r.key,
    name: r.name || r.key,
    ra: num(r.ra) ?? NaN,
    dec: num(r.dec) ?? NaN,
    distanceKpc: num(r.distance) ?? NaN,
    confirmedReal: int(r.confirmed_real),
    confirmedGalaxy: int(r.confirmed_galaxy),
    rhalfPhysicalPc: num(r.rhalf_physical),
    ellipticity: num(r.ellipticity),
    positionAngle: num(r.position_angle),
    apparentMagV: num(r.apparent_magnitude_v),
    nSersic: num(r.n_sersic),
  }));
}

const OVERRIDES_FILE = 'data/local-group/overrides.tsv';
const OVERRIDES_HINT = 'It is hand-curated; see /data/local-group/README.md#override-schema.';
const OVERRIDES_REQUIRED = ['name', 'a_pc', 'b_pc', 'c_pc', 'orient', 'source'] as const;
const OVERRIDES_OPTIONAL = [
  'ra_deg', 'dec_deg', 'distance_kpc', 'm_v', 'profile', 'n_sersic', 'r_d_pc',
  'bulge_to_total', 'bulge_re_pc', 'bulge_n', 'color',
] as const;
type OverridesColumn = (typeof OVERRIDES_REQUIRED)[number] | (typeof OVERRIDES_OPTIONAL)[number];

const OVERRIDES = {
  file: OVERRIDES_FILE,
  columns: OVERRIDES_REQUIRED,
  optional: OVERRIDES_OPTIONAL,
  hint: OVERRIDES_HINT,
  comments: true,
} satisfies TableSpec<OverridesColumn>;

/** Schema and per-column semantics: /data/local-group/README.md#override-schema. */
export function parseOverrides(tsv: string): OverrideRow[] {
  return [...readTable(OVERRIDES, tsv)].map(overrideRow);
}

function overrideRow(row: TableRow<OverridesColumn>): OverrideRow {
  const opt = (col: (typeof OVERRIDES_OPTIONAL)[number]): string | undefined => row.text(col) ?? undefined;
  const optNum = (col: (typeof OVERRIDES_OPTIONAL)[number]): number | undefined => row.float(col) ?? undefined;
  const axis = (col: 'a_pc' | 'b_pc' | 'c_pc'): number => row.float(col) ?? row.fail(`${col} is empty`);
  const name = row.text('name') ?? '';
  const result: OverrideRow = {
    name,
    axes: [axis('a_pc'), axis('b_pc'), axis('c_pc')],
    orient: row.text('orient') ?? '',
  };
  // Standalone position columns: all three must be present and
  // non-empty for the row to stand alone — partial population is a
  // config error worth surfacing.
  {
    const ra = optNum('ra_deg');
    const dec = optNum('dec_deg');
    const dist = optNum('distance_kpc');
    const count = [ra, dec, dist].filter((v) => v !== undefined).length;
    if (count > 0 && count < 3) {
      throw new Error(
        `overrides.tsv: '${name}' partially populates standalone position (ra/dec/distance) — all three must be set together or all empty`,
      );
    }
    if (count === 3) {
      result.raDeg = ra;
      result.decDeg = dec;
      result.distanceKpc = dist;
    }
  }
  const mV = optNum('m_v');
  if (mV !== undefined) result.mV = mV;
  const profile = opt('profile');
  if (profile !== undefined) {
    if (profile !== 'disc' && profile !== 'sersic') {
      throw new Error(`overrides.tsv: '${name}' has unrecognised profile '${profile}'`);
    }
    result.profile = profile;
  }
  const nSersic = optNum('n_sersic');
  if (nSersic !== undefined) result.nSersic = nSersic;
  const rdPc = optNum('r_d_pc');
  if (rdPc !== undefined) result.rdPc = rdPc;
  {
    const bt = optNum('bulge_to_total');
    const re = optNum('bulge_re_pc');
    const bn = optNum('bulge_n');
    const count = [bt, re, bn].filter((v) => v !== undefined).length;
    if (count > 0 && count < 3) {
      throw new Error(
        `overrides.tsv: '${name}' partially populates the bulge (bulge_to_total/bulge_re_pc/bulge_n) — all three must be set together or all empty`,
      );
    }
    if (count === 3) {
      result.bulgeToTotal = bt;
      result.bulgeRePc = re;
      result.bulgeN = bn;
    }
  }
  const color = opt('color');
  if (color !== undefined) result.color = color;
  return result;
}

/** Parse aliases.tsv: name<TAB>type[<TAB>alias1|alias2…[<TAB>canonical]].
 *  Comments and blank lines skipped; the first non-comment line is the
 *  header. Designations are normalised to their conventional form on the
 *  way in, so a curator writing "M 110" and "M110" in different columns
 *  still matches. A `canonical` naming no listed alias is a curation typo
 *  — the promoted name would be untypeable in search. */
const ALIASES = {
  file: 'data/local-group/aliases.tsv',
  columns: ['name', 'type', 'aliases', 'canonical'] as const,
  hint: 'It is hand-curated; see data/local-group/README.md.',
  comments: true,
} satisfies TableSpec<string>;

export function parseAliases(tsv: string): AliasRow[] {
  return [...readTable(ALIASES, tsv)].map((row) => {
    const name = row.text('name') ?? '';
    const type = row.text('type');
    if (type === null) return row.fail(`'${name}' has an empty type`);
    const aliases = row.raw('aliases')
      .split('|')
      .map((s) => canonicalDesignation(s.trim()))
      .filter(Boolean);
    const canonical = canonicalDesignation(row.text('canonical') ?? '');
    if (canonical && !aliases.includes(canonical)) {
      row.fail(`'${name}' promotes '${canonical}', which is not one of its aliases`);
    }
    return {
      name,
      type,
      aliases,
      ...(canonical ? { canonical } : {}),
    };
  });
}

/** Trims numeric precision so repeat builds produce stable diffs. */
function sersicParamsToJson(p: SersicParams) {
  return {
    reffAxesPc: p.reffAxesPc.map((v) => roundN(v, 2)),
    n: roundN(p.n, 4),
    bn: roundN(p.bn, 6),
    pn: roundN(p.pn, 6),
    uMax: roundN(p.uMax, 4),
    density0: roundSig(p.density0, 8),
  };
}

function emissionToJson(e: LgEmission) {
  if (e.family === 'sersic') {
    return {
      family: e.family,
      mV: roundN(e.mV, 2),
      ...(e.color ? { color: e.color } : {}),
      ...sersicParamsToJson(e),
    };
  }
  return {
    family: e.family,
    mV: roundN(e.mV, 2),
    ...(e.color ? { color: e.color } : {}),
    rdPc: roundN(e.rdPc, 2),
    zdPc: roundN(e.zdPc, 2),
    rEnvPc: roundN(e.rEnvPc, 2),
    zEnvPc: roundN(e.zEnvPc, 2),
    density0: roundSig(e.density0, 8),
    ...(e.bulge ? { bulge: sersicParamsToJson(e.bulge) } : {}),
  };
}

function toJsonObject(o: LgObject) {
  return {
    name: o.name,
    id: o.id,
    type: o.type,
    ...(o.aliases ? { aliases: o.aliases } : {}),
    center: o.center.map((v) => roundN(v, 2)),
    kind: o.kind,
    axes: o.axes.map((v) => roundN(v, 2)),
    quat: o.quat.map((v) => roundN(v, 6)),
    source: o.source,
    distance: roundN(o.distance, 1),
    emission: emissionToJson(o.emission),
  };
}

function isUpToDate(): boolean {
  if (!existsSync(OUT)) return false;
  const outMtime = statSync(OUT).mtimeMs;
  for (const src of [SRC_CSV, SRC_OVERRIDES, SRC_ALIASES, __filename, resolve(__dirname, 'build-local-group-pure.ts')]) {
    if (!existsSync(src)) return false;
    if (statSync(src).mtimeMs > outMtime) return false;
  }
  return true;
}

async function main(): Promise<void> {
  sweepStaged(LOCAL_GROUP_OUTPUTS);
  const force = process.argv.includes('--force');
  if (!force && isUpToDate()) {
    console.log('local-group.json up to date — skipping (use --force to rebuild)');
    return;
  }

  if (!existsSync(SRC_CSV)) {
    console.error(`error: missing ${SRC_CSV}`);
    process.exit(1);
  }
  if (!existsSync(SRC_OVERRIDES)) {
    console.error(`error: missing ${SRC_OVERRIDES}`);
    process.exit(1);
  }

  const lvdb = parseLvdb(readFileSync(SRC_CSV, 'utf8'));
  const overrides = parseOverrides(readFileSync(SRC_OVERRIDES, 'utf8'));
  const overrideByName = new Map(overrides.map((o) => [o.name, o]));
  const aliasRows = existsSync(SRC_ALIASES)
    ? parseAliases(readFileSync(SRC_ALIASES, 'utf8'))
    : [];
  const aliasByName = new Map(aliasRows.map((a) => [a.name, a]));
  const aliasMatched = new Set<string>();

  const renderable = filterForRendering(lvdb);
  const objects: LgObject[] = [];
  const overrideMatched = new Set<string>();
  let overrideHits = 0;
  let lvdbDefaultHits = 0;
  let skippedNoStructure = 0;
  for (const row of renderable) {
    const merged = mergeRowAndOverride(row, overrideByName.get(row.name));
    if (!merged) {
      skippedNoStructure += 1;
      continue;
    }
    if (merged.source === 'OVERRIDE') {
      overrideHits += 1;
      overrideMatched.add(row.name);
    } else {
      lvdbDefaultHits += 1;
    }
    const alias = aliasByName.get(row.name);
    if (alias) aliasMatched.add(row.name);
    objects.push(applyAliasMeta(merged, alias));
  }

  // Standalone overrides — rows that name objects not present in LVDB
  // (M31, M33). The TSV parse already enforced that ra/dec/distance are
  // populated for any unmatched row; buildStandaloneOverride throws if
  // not, so a config error surfaces loudly here.
  let standaloneHits = 0;
  let skippedOutOfRange = 0;
  for (const ov of overrides) {
    if (overrideMatched.has(ov.name)) continue;
    const built = buildStandaloneOverride(ov);
    if (!built) {
      skippedOutOfRange += 1;
      continue;
    }
    standaloneHits += 1;
    const alias = aliasByName.get(ov.name);
    if (alias) aliasMatched.add(ov.name);
    objects.push(applyAliasMeta(built, alias));
  }

  // An alias row that matched nothing is a curation typo — fail loud
  // rather than silently dropping a search designation.
  const orphanAliases = aliasRows.filter((a) => !aliasMatched.has(a.name));
  if (orphanAliases.length > 0) {
    throw new Error(
      `aliases.tsv: no rendered object matches ${orphanAliases.map((a) => `'${a.name}'`).join(', ')}`,
    );
  }

  // Two objects under one display name would render two identical labels
  // and two indistinguishable search rows. A `canonical` promotion is the
  // only way to collide, so the guard sits with the other curation checks.
  const byDisplayName = new Map<string, string[]>();
  for (const o of objects) {
    byDisplayName.set(o.name, [...(byDisplayName.get(o.name) ?? []), o.id]);
  }
  const collisions = [...byDisplayName].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    throw new Error(
      `local-group: display name collision — ${collisions
        .map(([name, ids]) => `'${name}' (${ids.join(', ')})`)
        .join('; ')}`,
    );
  }

  // Stable order — by name, case-insensitive — so repeat builds emit
  // byte-identical artifacts.
  objects.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const payload = {
    version: 2,
    count: objects.length,
    objects: objects.map(toJsonObject),
  };
  emitArtifacts({
    outputs: LOCAL_GROUP_OUTPUTS,
    files: { localGroup: JSON.stringify(payload, null, 0) + '\n' },
  });

  console.log(
    `wrote ${OUT.replace(ROOT + '/', '')} ` +
    `(${objects.length} objects: ${overrideHits} LVDB+override, ` +
    `${lvdbDefaultHits} LVDB-only, ${standaloneHits} standalone override; ` +
    `${skippedNoStructure} LVDB rows skipped — no structural data; ` +
    `${skippedOutOfRange} standalone overrides skipped — past MAX_DISTANCE_PC)`,
  );
  // Reference the unused symbol so the import survives tree-shaking
  // analysis in the test path that imports this file for the parsers.
  void buildOrientationQuat;
}

// Run as a script. ESM doesn't have require.main; gate on the entry-point
// path being our own filename instead.
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runStep(main);
}
