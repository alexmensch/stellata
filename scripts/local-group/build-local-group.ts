// Build the Local Group catalog consumed by the client wireframe
// layer. See scripts/local-group/README.md for inputs, output schema,
// idempotency, and the LVDB-refresh protocol.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import {
  applyAliasMeta,
  buildOrientationQuat,
  buildStandaloneOverride,
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
const OUT = resolve(ROOT, 'public/local-group.json');

/** Parse the LVDB CSV into a flat array of rows. Coerces strings to
 *  numbers / null per LVDB convention ("" = missing for numeric cols). */
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

/** Parse overrides.tsv (header line + tab-separated rows; lines starting
 *  with # are comments).
 *
 *  Schema (6 required columns; optional columns follow, looked up by
 *  header name):
 *
 *    name<TAB>a_pc<TAB>b_pc<TAB>c_pc<TAB>orient<TAB>ref_doi
 *      [<TAB>ra_deg<TAB>dec_deg<TAB>distance_kpc]
 *      [<TAB>m_v<TAB>profile<TAB>n_sersic<TAB>r_d_pc
 *       <TAB>bulge_to_total<TAB>bulge_re_pc<TAB>bulge_n
 *       <TAB>ref_doi_profile<TAB>color]
 *
 *  ra_deg/dec_deg/distance_kpc are populated only for objects that
 *  aren't in LVDB at all (M31, M33). When present, the row is fully
 *  self-contained — buildStandaloneOverride synthesises an LgObject
 *  without an LVDB merge. When absent, the row supplements an LVDB row
 *  whose position drives the merge. The emission columns feed
 *  buildEmission; see data/local-group/README.md for per-column
 *  semantics.
 *
 *  Label visibility is governed at runtime (apparent-size ranking)
 *  rather than per-row, so no threshold column. */
export function parseOverrides(tsv: string): OverrideRow[] {
  const out: OverrideRow[] = [];
  const lines = tsv.split(/\r?\n/);
  let colIndex: Map<string, number> | null = null;
  for (const raw of lines) {
    if (!raw || raw.startsWith('#')) continue;
    const fields = raw.split('\t');
    if (!colIndex) {
      // First non-comment line is the header. Sanity-check that the
      // required leading columns are present in the expected order so a
      // schema drift surfaces loudly at build time; optional columns are
      // resolved by name from the header so their order can evolve.
      const required = ['name', 'a_pc', 'b_pc', 'c_pc', 'orient', 'ref_doi'];
      if (fields.length < required.length) {
        throw new Error(`overrides.tsv: malformed header (got ${fields.length} fields, expected ≥ ${required.length})`);
      }
      for (let i = 0; i < required.length; i++) {
        if (fields[i].trim() !== required[i]) {
          throw new Error(`overrides.tsv: header column ${i} is '${fields[i]}', expected '${required[i]}'`);
        }
      }
      colIndex = new Map(fields.map((f, i) => [f.trim(), i]));
      continue;
    }
    if (fields.length < 6) continue;
    const opt = (col: string): string | undefined => {
      const i = colIndex!.get(col);
      if (i === undefined || i >= fields.length) return undefined;
      const v = fields[i].trim();
      return v === '' ? undefined : v;
    };
    const optNum = (col: string): number | undefined => {
      const v = opt(col);
      if (v === undefined) return undefined;
      const parsed = Number(v);
      if (!Number.isFinite(parsed)) {
        throw new Error(`overrides.tsv: '${fields[0].trim()}' has non-numeric ${col} '${v}'`);
      }
      return parsed;
    };
    const row: OverrideRow = {
      name: fields[0].trim(),
      axes: [parseFloat(fields[1]), parseFloat(fields[2]), parseFloat(fields[3])],
      orient: fields[4].trim(),
      refDoi: fields[5].trim(),
    };
    // Standalone position columns: all three must be present and
    // non-empty for the row to stand alone — partial population is a
    // config error worth surfacing.
    {
      const ra = optNum('ra_deg');
      const dec = optNum('dec_deg');
      const dist = optNum('distance_kpc');
      const present = [ra, dec, dist].filter((v) => v !== undefined).length;
      if (present > 0 && present < 3) {
        throw new Error(
          `overrides.tsv: '${row.name}' partially populates standalone position (ra/dec/distance) — all three must be set together or all empty`,
        );
      }
      if (present === 3) {
        row.raDeg = ra;
        row.decDeg = dec;
        row.distanceKpc = dist;
      }
    }
    const mV = optNum('m_v');
    if (mV !== undefined) row.mV = mV;
    const profile = opt('profile');
    if (profile !== undefined) {
      if (profile !== 'disc' && profile !== 'sersic') {
        throw new Error(`overrides.tsv: '${row.name}' has unrecognised profile '${profile}'`);
      }
      row.profile = profile;
    }
    const nSersic = optNum('n_sersic');
    if (nSersic !== undefined) row.nSersic = nSersic;
    const rdPc = optNum('r_d_pc');
    if (rdPc !== undefined) row.rdPc = rdPc;
    {
      const bt = optNum('bulge_to_total');
      const re = optNum('bulge_re_pc');
      const bn = optNum('bulge_n');
      const present = [bt, re, bn].filter((v) => v !== undefined).length;
      if (present > 0 && present < 3) {
        throw new Error(
          `overrides.tsv: '${row.name}' partially populates the bulge (bulge_to_total/bulge_re_pc/bulge_n) — all three must be set together or all empty`,
        );
      }
      if (present === 3) {
        row.bulgeToTotal = bt;
        row.bulgeRePc = re;
        row.bulgeN = bn;
      }
    }
    const refDoiProfile = opt('ref_doi_profile');
    if (refDoiProfile !== undefined) row.refDoiProfile = refDoiProfile;
    const color = opt('color');
    if (color !== undefined) row.color = color;
    out.push(row);
  }
  return out;
}

/** Parse aliases.tsv: name<TAB>type[<TAB>alias1|alias2…]. Comments and
 *  blank lines skipped; the first non-comment line is the header. */
export function parseAliases(tsv: string): AliasRow[] {
  const out: AliasRow[] = [];
  let headerSeen = false;
  for (const raw of tsv.split(/\r?\n/)) {
    if (!raw || raw.startsWith('#')) continue;
    const fields = raw.split('\t');
    if (!headerSeen) {
      if (fields[0].trim() !== 'name' || fields[1]?.trim() !== 'type' || fields[2]?.trim() !== 'aliases') {
        throw new Error('aliases.tsv: malformed header (expected name<TAB>type<TAB>aliases)');
      }
      headerSeen = true;
      continue;
    }
    if (fields.length < 2) continue;
    const type = fields[1].trim();
    if (!type) throw new Error(`aliases.tsv: '${fields[0].trim()}' has an empty type`);
    out.push({
      name: fields[0].trim(),
      type,
      aliases: (fields[2] ?? '').split('|').map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

/** Convert merged LgObject(s) to the on-disk JSON shape. Trims numeric
 *  precision so repeat builds produce stable diffs. */
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

  // Stable order — by name, case-insensitive — so repeat builds emit
  // byte-identical artifacts.
  objects.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  await mkdir(dirname(OUT), { recursive: true });
  const payload = {
    version: 2,
    count: objects.length,
    objects: objects.map(toJsonObject),
  };
  await writeFile(OUT, JSON.stringify(payload, null, 0) + '\n');

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
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
