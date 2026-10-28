// Build the Local Group catalog consumed by the client wireframe
// layer. See scripts/local-group/README.md for inputs, output schema,
// idempotency, and the LVDB-refresh protocol.

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitArtifacts, runStep, sweepStaged } from '../util/emit-artifacts';
import { LOCAL_GROUP_OUTPUTS } from './local-group-outputs';
import { LG_ALIASES, LG_OVERRIDES, LVDB } from './local-group-source';
import {
  applyAliasMeta,
  buildOrientationQuat,
  buildStandaloneOverride,
  filterForRendering,
  mergeRowAndOverride,
  roundN,
  roundSig,
  type LgEmission,
  type LgObject,
  type SersicParams,
} from './build-local-group-pure';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

const OUT = LOCAL_GROUP_OUTPUTS.files.localGroup;

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
  const data = [LVDB, LG_OVERRIDES, LG_ALIASES].flatMap((src) => src.files()).map((file) => resolve(ROOT, file));
  for (const src of [...data, __filename, resolve(__dirname, 'build-local-group-pure.ts')]) {
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

  const lvdb = LVDB.read();
  const overrides = LG_OVERRIDES.read();
  const overrideByName = new Map(overrides.map((o) => [o.name, o]));
  const aliasRows = LG_ALIASES.read();
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
