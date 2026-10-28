// Refreshes the naming parity ledger from the built artifacts.
// `pnpm run build:naming-parity`. See README.md#the-parity-ledger.

import { readFileSync } from 'node:fs';

import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import {
  DEFAULT_CONSTELLATIONS_JSON, DEFAULT_ROW_INDEX_MAP, DEFAULT_SEARCH_INDEX,
} from '../catalog-lookup';
import type { SearchEntry } from '../record/catalog-pure';
import { buildSearchIndex, normalizeGlKey } from '../../../src/client/typeahead/search-corpus';
import { displayNamesFromSearchIndex } from './star-naming-pure';
import { readTable } from '../../util/tsv/table-pure';
import { readArtifact } from '../../util/sources/source';
import {
  labelIndexOf,
  labelResolvesTo,
  ledgerKeys,
  type DuplicateRow,
  type ParityRow,
  type RowIndexMap,
} from './naming-parity-pure';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';
import { NAMING_PARITY_OUTPUTS } from './naming-parity-outputs';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** FROZEN, and carried forward from the committed ledger.
 *  `NAMING_PARITY_SEED` re-seeds it from a `key`/`old` TSV, which is what a
 *  deliberate wholesale naming change needs and nothing else should
 *  touch. */
function frozenOldLabels(): Map<string, string> {
  const seed = process.env.NAMING_PARITY_SEED;
  if (seed !== undefined) {
    const spec = {
      file: seed,
      columns: ['key', 'old'] as const,
      hint: 'NAMING_PARITY_SEED must name a key/old TSV.',
    };
    return new Map([...readTable(spec, readFileSync(seed, 'utf8'))].map((r) => [r.raw('key'), r.raw('old')]));
  }
  const rows = readArtifact(NAMING_PARITY);
  return new Map(rows.map((r) => [r.key, r.old]));
}

function main(): void {
  const raw = readJson<SearchEntry[]>(DEFAULT_SEARCH_INDEX);
  const rowIndexMap = readJson<RowIndexMap>(DEFAULT_ROW_INDEX_MAP);
  const constellations = readJson<{ code: string; name: string }[]>(DEFAULT_CONSTELLATIONS_JSON);
  const keys = ledgerKeys(rowIndexMap);
  const composed = displayNamesFromSearchIndex(raw, constellations);
  const labelByKey = new Map<string, string>();
  const indexByKey = new Map<string, number>();
  for (const entry of raw) {
    const key = keys.get(entry.i);
    if (key === undefined) continue;
    labelByKey.set(key, composed.get(entry.i)?.label ?? '');
    indexByKey.set(key, entry.i);
  }

  const searchIndex = buildSearchIndex(raw, constellations);
  const byLabel = labelIndexOf(searchIndex);
  const old = frozenOldLabels();
  const rows: ParityRow[] = [];
  for (const [key, oldLabel] of old) {
    const idx = indexByKey.get(key);
    rows.push({
      key,
      old: oldLabel,
      record: idx === undefined
        ? { present: false }
        : {
          present: true,
          new: labelByKey.get(key) ?? '',
          resolves: labelResolvesTo(searchIndex, byLabel, normalizeGlKey, oldLabel, idx),
        },
    });
  }
  const changed = rows.filter((r) => !r.record.present || r.old !== r.record.new);
  const present = changed.flatMap((r) => (r.record.present ? [r.record] : []));

  const claimants = new Map<string, string[]>();
  for (const [key, label] of labelByKey) {
    if (label === '') continue;
    const bucket = claimants.get(label);
    if (bucket) bucket.push(key);
    else claimants.set(label, [key]);
  }
  const duplicates: DuplicateRow[] = [];
  for (const [label, ks] of claimants) {
    if (ks.length > 1) duplicates.push({ label, keys: ks.sort() });
  }
  emitArtifacts({
    outputs: NAMING_PARITY_OUTPUTS,
    files: {
      parity: NAMING_PARITY.serialize(changed),
      duplicates: NAMING_DUPLICATES.serialize(duplicates),
    },
  });

  console.log(
    `naming-parity.tsv: ${changed.length} of ${rows.length} frozen pre-ladder ` +
      `labels still differ ` +
      `(${changed.length - present.length} no longer in the catalogue, ` +
      `${present.filter((r) => r.new === '').length} now unlabelled, ` +
      `${present.filter((r) => !r.resolves).length} whose old label no longer ` +
      `resolves)`,
  );
  console.log(`naming-duplicates.tsv: ${duplicates.length} duplicate label(s)`);
}

runStep(main);