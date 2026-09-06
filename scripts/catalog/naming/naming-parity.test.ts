// The naming parity gate (docs/star-naming.md § 8) over the built
// artifacts. See README.md § The parity ledger.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../util/paths';
import type { SearchEntry } from '../catalog-pure';
import { buildSearchIndex, normalizeGlKey } from '../../../src/client/typeahead/search-corpus';
import { displayNamesFromSearchIndex } from './star-naming-pure';
import { foldNameKey } from './wgsn-normalise-pure';
import { parseWgsnNamesTsv } from './wgsn-index-pure';
import {
  labelIndexOf,
  labelResolvesTo,
  ledgerKeys,
  parseDuplicateLedger,
  parseParityLedger,
  type RowIndexMap,
} from './naming-parity-pure';

const HERE = resolve(REPO_ROOT, 'scripts/catalog/naming');
const SEARCH_INDEX = resolve(REPO_ROOT, 'public/search-index.json');
const ROW_INDEX_MAP = resolve(REPO_ROOT, 'public/catalog-row-index-map.json');
const CONSTELLATIONS = resolve(REPO_ROOT, 'public/constellations.json');
const WGSN_NAMES = resolve(REPO_ROOT, 'data/iau-wgsn/wgsn_names.tsv');
const MANIFEST = resolve(REPO_ROOT, 'data/membership/membership-manifest.tsv');

/** Published names reaching no record: the wgsnFaints hosts whose only key
 *  was a survey id the normaliser drops (they name stars outside the
 *  catalogue), plus `Red Rectangle`, which names the nebula around HD 44179
 *  rather than the star (docs/star-naming.md § 2). RATCHET DOWN — it last
 *  moved when the membership manifest admitted a record for one of them. */
const PUBLISHED_NAMES_UNREACHED = 54;
const FIXTURES_READY = existsSync(SEARCH_INDEX) && existsSync(ROW_INDEX_MAP)
  && existsSync(CONSTELLATIONS);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const parity = parseParityLedger(readFileSync(resolve(HERE, 'naming-parity.tsv'), 'utf8'));
const duplicates = parseDuplicateLedger(
  readFileSync(resolve(HERE, 'naming-duplicates.tsv'), 'utf8'),
);

interface Fixtures {
  raw: SearchEntry[];
  constellations: { code: string; name: string }[];
  labelByKey: Map<string, string>;
  entryByKey: Map<string, SearchEntry>;
}

function loadFixtures(): Fixtures {
  const raw = readJson<SearchEntry[]>(SEARCH_INDEX);
  const constellations = readJson<{ code: string; name: string }[]>(CONSTELLATIONS);
  const keys = ledgerKeys(readJson<RowIndexMap>(ROW_INDEX_MAP));
  const composed = displayNamesFromSearchIndex(raw, constellations);
  const labelByKey = new Map<string, string>();
  const entryByKey = new Map<string, SearchEntry>();
  for (const entry of raw) {
    const key = keys.get(entry.i);
    if (key === undefined) continue;
    labelByKey.set(key, composed.get(entry.i)?.label ?? '');
    entryByKey.set(key, entry);
  }
  return { raw, constellations, labelByKey, entryByKey };
}

// Read here, not in the describe body: vitest runs a skipped suite's factory
// to collect its tests, so a read inside it throws whatever the gate says.
const FIXTURES: Fixtures | null = FIXTURES_READY ? loadFixtures() : null;

describe.runIf(FIXTURES_READY)('naming parity ledger', () => {
  it('every enumerated display change is exactly what the ladder composes', () => {
    const { labelByKey } = FIXTURES!;
    // § 8.2: display changes are enumerated, not counted. Reviewed once,
    // then pinned — a drift here means a record's label moved without the
    // ledger being refreshed (`pnpm run build:naming-parity`).
    const drifted = parity
      .filter((row) => (labelByKey.get(row.key) ?? '') !== row.new)
      .map((row) => `${row.key}: ledger "${row.new}", built "${labelByKey.get(row.key) ?? ''}"`);
    expect(drifted.slice(0, 20)).toEqual([]);
  });

  it('every ledger row is a change, keyed once', () => {
    // The pre-ladder label is knowable only from the committed `old`
    // column, so a change the ledger omits is unreachable from here — a
    // re-seed is what enumerates the set (README.md § The parity ledger).
    const enumerated = new Set(parity.map((row) => row.key));
    const missing: string[] = [];
    for (const row of parity) {
      if (row.old === row.new) missing.push(`${row.key}: unchanged row in the ledger`);
    }
    expect(missing.slice(0, 20)).toEqual([]);
    expect(enumerated.size).toBe(parity.length);
  });

  it('every published name resolves, and every displaced label as pinned', () => {
    // § 8.1's hard invariant, stated over the strings that HAVE external
    // provenance: every name the authority approves and every name the
    // manifest carries must reach a record. A string the build composed
    // itself has none, so § 5 lets it disappear with the composition —
    // which is what the ledger's `resolves` column enumerates, reviewed
    // once and pinned so a later change cannot quietly widen the set.
    const { raw, constellations, entryByKey } = FIXTURES!;
    const index = buildSearchIndex(raw, constellations);
    const byLabel = labelIndexOf(index);
    const anyRecord = (label: string): boolean =>
      byLabel.has(label.toLowerCase());

    const published = new Set<string>();
    for (const row of parseWgsnNamesTsv(readFileSync(WGSN_NAMES, 'utf8'))) {
      for (const spelling of [row.name, ...row.aliases]) published.add(spelling);
    }
    const manifest = readFileSync(MANIFEST, 'utf8').split('\n');
    const properCol = manifest[0].split('\t').indexOf('proper');
    for (const line of manifest.slice(1)) {
      const cell = (line.split('\t')[properCol] ?? '').trim();
      if (cell !== '') published.add(cell);
    }
    // A name the authority approves for a star the catalogue does not carry
    // has no record to reach; those are counted at ingest
    // (`namingIauUnreached`) rather than asserted here.
    const folded = new Set([...byLabel.keys()].map(foldNameKey));
    const unfindable = [...published]
      .filter((name) => !anyRecord(name) && !folded.has(foldNameKey(name)));
    expect(unfindable.length, `published names that resolve nothing: ${
      unfindable.slice(0, 20).join(', ')}`).toBe(PUBLISHED_NAMES_UNREACHED);

    const drifted: string[] = [];
    for (const row of parity) {
      const entry = entryByKey.get(row.key);
      const resolves = entry !== undefined
        && labelResolvesTo(index, byLabel, normalizeGlKey, row.old, entry.i);
      if (resolves !== row.resolves) {
        drifted.push(`${row.key}: "${row.old}" resolves=${resolves}, pinned ${row.resolves}`);
      }
    }
    expect(drifted.slice(0, 30)).toEqual([]);
  });

  it('duplicate composed labels are exactly the enumerated data findings', () => {
    // § 8.4: the composer is injective given (naming anchor, component
    // letter), so a duplicate is two catalogue entries claiming one
    // designation. RATCHET DOWN — every row is a curation finding, and the
    // fix is upstream rather than a qualifier bolted onto the label.
    const { labelByKey } = FIXTURES!;
    const claimants = new Map<string, string[]>();
    for (const [key, label] of labelByKey) {
      if (label === '') continue;
      const bucket = claimants.get(label);
      if (bucket) bucket.push(key);
      else claimants.set(label, [key]);
    }
    const built = [...claimants.entries()]
      .filter(([, keys_]) => keys_.length > 1)
      .map(([label, keys_]) => `${label}\t${[...keys_].sort().join('|')}`)
      .sort();
    const pinned = duplicates
      .map((row) => `${row.label}\t${[...row.keys].sort().join('|')}`)
      .sort();
    expect(built).toEqual(pinned);
  });
});
