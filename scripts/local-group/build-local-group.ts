// Build the Local Group catalog consumed by the client wireframe
// layer. See scripts/local-group/README.md for inputs, output schema,
// idempotency, and the LVDB-refresh protocol.

import { codeCount } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { allocateSibling, emitSibling, siblingLineage } from '../sid/sibling-allocation';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { sweepStaged } from '../util/emit-artifacts';
import { LOCAL_GROUP_JSON } from './local-group-json';
import { LOCAL_GROUP_OUTPUTS } from './local-group-outputs';
import { LG_ALIASES, LG_OVERRIDES, LVDB } from './local-group-source';
import {
  applyAliasMeta,
  buildStandaloneOverride,
  filterForRendering,
  localGroupPayload,
  mergeRowAndOverride,
} from './build-local-group-pure';
import type { LgObjectRow } from '../../src/catalog-format/local-group/local-group-schema';

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

  const spec = SIBLING_ARTIFACTS['local-group'];
  const allocation = allocateSibling(spec, LOCAL_GROUP_JSON, objects);
  const lineage = siblingLineage(spec, allocation);
  emitSibling(
    LOCAL_GROUP_OUTPUTS, { localGroup: LOCAL_GROUP_JSON.serialize(localGroupPayload(objects, allocation.sids)) }, allocation,
    lineage,
  );

  console.log(
    `wrote ${LOCAL_GROUP_JSON.file} ` +
    `(${objects.length} objects: ${overrideHits} LVDB+override, ` +
    `${lvdbDefaultHits} LVDB-only, ${standaloneHits} standalone override; ` +
    `${skippedNoStructure} LVDB rows skipped — no structural data; ` +
    `${skippedOutOfRange} standalone overrides skipped — past MAX_DISTANCE_PC; ` +
    `${codeCount(spec.codes, lineage.counts)('minted')} lg SIDs minted)`,
  );
}
