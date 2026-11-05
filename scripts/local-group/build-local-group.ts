// Build the Local Group catalog consumed by the client wireframe
// layer. See scripts/local-group/README.md for inputs, output schema,
// idempotency, and the LVDB-refresh protocol.

import { allocateSibling, emitSibling } from '../sid/sibling-allocation';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { sweepStaged } from '../util/emit-artifacts';
import { roundHalfEven, roundSignificant } from '../util/round-pure';
import { LOCAL_GROUP_JSON } from './local-group-json';
import { LOCAL_GROUP_OUTPUTS } from './local-group-outputs';
import { LG_ALIASES, LG_OVERRIDES, LVDB } from './local-group-source';
import {
  applyAliasMeta,
  buildStandaloneOverride,
  filterForRendering,
  mergeRowAndOverride,
} from './build-local-group-pure';
import {
  LOCAL_GROUP_VERSION,
  type LgObjectRow,
  type LgEmission,
  type SersicParams,
} from '../../src/catalog-format/local-group/local-group-schema';

const roundEach = <T extends readonly number[]>(v: T, digits: number): T => (
  v.map((x) => roundHalfEven(x, digits)) as unknown as T
);

/** Trims numeric precision so repeat builds produce stable diffs. */
function sersicParamsToJson(p: SersicParams): SersicParams {
  return {
    reffAxesPc: roundEach(p.reffAxesPc, 2),
    n: roundHalfEven(p.n, 4),
    bn: roundHalfEven(p.bn, 6),
    pn: roundHalfEven(p.pn, 6),
    uMax: roundHalfEven(p.uMax, 4),
    density0: roundSignificant(p.density0, 8),
  };
}

function emissionToJson(e: LgEmission): LgEmission {
  if (e.family === 'sersic') {
    return {
      family: e.family,
      mV: roundHalfEven(e.mV, 2),
      ...(e.color ? { color: e.color } : {}),
      ...sersicParamsToJson(e),
    };
  }
  return {
    family: e.family,
    mV: roundHalfEven(e.mV, 2),
    ...(e.color ? { color: e.color } : {}),
    rdPc: roundHalfEven(e.rdPc, 2),
    zdPc: roundHalfEven(e.zdPc, 2),
    rEnvPc: roundHalfEven(e.rEnvPc, 2),
    zEnvPc: roundHalfEven(e.zEnvPc, 2),
    density0: roundSignificant(e.density0, 8),
    ...(e.bulge ? { bulge: sersicParamsToJson(e.bulge) } : {}),
  };
}

function toJsonObject(o: LgObjectRow): LgObjectRow {
  return {
    name: o.name,
    id: o.id,
    type: o.type,
    ...(o.aliases ? { aliases: o.aliases } : {}),
    center: roundEach(o.center, 2),
    kind: o.kind,
    axes: roundEach(o.axes, 2),
    quat: roundEach(o.quat, 6),
    source: o.source,
    distance: roundHalfEven(o.distance, 1),
    emission: emissionToJson(o.emission),
  };
}

export async function main(): Promise<void> {
  sweepStaged(LOCAL_GROUP_OUTPUTS);
  const lvdb = LVDB.read();
  const overrides = LG_OVERRIDES.read();
  const overrideByName = new Map(overrides.map((o) => [o.name, o]));
  const aliasRows = LG_ALIASES.read();
  const aliasByName = new Map(aliasRows.map((a) => [a.name, a]));
  const aliasMatched = new Set<string>();

  const renderable = filterForRendering(lvdb);
  const objects: LgObjectRow[] = [];
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

  const allocation = allocateSibling(SIBLING_ARTIFACTS['local-group'], objects);
  const payload = {
    version: LOCAL_GROUP_VERSION,
    count: objects.length,
    objects: objects.map((o, i) => ({ ...toJsonObject(o), sid: allocation.sids[i] })),
  };
  emitSibling(LOCAL_GROUP_OUTPUTS, { localGroup: LOCAL_GROUP_JSON.serialize(payload) }, allocation);

  console.log(
    `wrote ${LOCAL_GROUP_JSON.file} ` +
    `(${objects.length} objects: ${overrideHits} LVDB+override, ` +
    `${lvdbDefaultHits} LVDB-only, ${standaloneHits} standalone override; ` +
    `${skippedNoStructure} LVDB rows skipped — no structural data; ` +
    `${skippedOutOfRange} standalone overrides skipped — past MAX_DISTANCE_PC; ` +
    `${allocation.minted} lg SIDs minted)`,
  );
}
