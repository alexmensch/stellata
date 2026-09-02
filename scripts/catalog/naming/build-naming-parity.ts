// Refreshes the naming parity ledger from the built artifacts.
// `pnpm run build:naming-parity`. See README.md § The parity ledger.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../../util/paths';
import type { SearchEntry } from '../catalog-pure';
import { buildSearchIndex, normalizeGlKey } from '../../../src/client/typeahead/search-corpus';
import { displayNamesFromSearchIndex } from './star-naming-pure';
import {
  formatDuplicateLedger,
  formatParityLedger,
  labelIndexOf,
  labelResolvesTo,
  ledgerKeys,
  parseParityLedger,
  type DuplicateRow,
  type ParityRow,
  type RowIndexMap,
} from './naming-parity-pure';

const PARITY = resolve(REPO_ROOT, 'scripts/catalog/naming/naming-parity.tsv');
const DUPLICATES = resolve(REPO_ROOT, 'scripts/catalog/naming/naming-duplicates.tsv');
const PUBLIC = resolve(REPO_ROOT, 'public');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(PUBLIC, name), 'utf8')) as T;
}

/** The `old` column is frozen — it is the string a user could type before
 *  the ladder landed, and the gate is that it still resolves. It carries
 *  forward from the committed ledger; `NAMING_PARITY_SEED` re-seeds it from
 *  a `key`/`old` TSV, which is what a deliberate wholesale naming change
 *  needs and nothing else should touch. */
function frozenOldLabels(): Map<string, string> {
  const seed = process.env.NAMING_PARITY_SEED;
  if (seed !== undefined) {
    const out = new Map<string, string>();
    const lines = readFileSync(seed, 'utf8').split('\n');
    for (const line of lines.slice(1)) {
      if (line.trim() === '') continue;
      const [key, old] = line.split('\t');
      out.set(key, old);
    }
    return out;
  }
  const rows = parseParityLedger(readFileSync(PARITY, 'utf8'));
  return new Map(rows.map((r) => [r.key, r.old]));
}

function main(): void {
  const raw = readJson<SearchEntry[]>('search-index.json');
  const rowIndexMap = readJson<RowIndexMap>('catalog-row-index-map.json');
  const constellations = readJson<{ code: string; name: string }[]>('constellations.json');
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
      new: labelByKey.get(key) ?? '',
      resolves: idx !== undefined
        && labelResolvesTo(searchIndex, byLabel, normalizeGlKey, oldLabel, idx),
    });
  }
  const changed = rows.filter((r) => r.old !== r.new);
  writeFileSync(PARITY, formatParityLedger(changed));

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
  writeFileSync(DUPLICATES, formatDuplicateLedger(duplicates));

  console.log(
    `naming-parity.tsv: ${changed.length} display changes of ${rows.length} ` +
      `records the pre-ladder build labelled ` +
      `(${changed.filter((r) => r.new === '').length} now unlabelled, ` +
      `${changed.filter((r) => !r.resolves).length} whose old label no longer ` +
      `resolves)`,
  );
  console.log(`naming-duplicates.tsv: ${duplicates.length} duplicate label(s)`);
}

main();
