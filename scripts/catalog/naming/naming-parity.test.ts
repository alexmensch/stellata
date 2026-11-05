// The naming parity gate (/docs/star-naming.md#8-parity--the-gate-on-any-naming-change) over the built
// artifacts. See README.md#the-parity-ledger.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, publicFile } from '../../util/paths';
import type { SearchEntry } from '../../../src/catalog-format/record/catalog-pure';
import { buildSearchIndex, normalizeGlKey } from '../../../src/catalog-format/naming/search-corpus';
import { displayNamesFromSearchIndex } from '../../../src/catalog-format/naming/star-naming-pure';
import { foldNameKey } from './wgsn-normalise-pure';
import { WGSN_NAMES } from './wgsn-names-tsv';
import {
  labelIndexOf,
  labelResolvesTo,
  ledgerKeys,
  type RowIndexMap,
} from './naming-parity-pure';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';
import { MEMBERSHIP_MANIFEST } from '../membership/membership-manifest-tsv';
import { loadCatalog } from '../catalog-lookup';
import { LINEAGE_LAYOUT } from '../lineage/lineage-layout-pure';
import { builtLabels, builtLabelsReady } from './built-labels';
import { PUBLIC_FILES } from '../../../src/catalog-format/public-artifacts/public-artifacts';
import { BUILD_FILES } from '../../../src/catalog-format/pipeline-outputs/build-files';

const WGSN_NAMES_PATH = resolve(REPO_ROOT, WGSN_NAMES.file);
const MANIFEST = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST.file);

/** Published names reaching no record: the wgsnFaints hosts whose only key
 *  was a survey id the normaliser drops (they name stars outside the
 *  catalogue), plus `Red Rectangle`, which names the nebula around HD 44179
 *  rather than the star (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them). RATCHET DOWN — it last
 *  moved when the membership manifest admitted a record for one of them. */
const PUBLISHED_NAMES_UNREACHED = 54;
const FIXTURES_READY = existsSync(publicFile(PUBLIC_FILES.searchIndex))
  && existsSync(resolve(REPO_ROOT, BUILD_FILES.catalogRowIndexMap))
  && existsSync(publicFile(PUBLIC_FILES.constellations))
  && builtLabelsReady(LINEAGE_LAYOUT.current);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const parity = NAMING_PARITY.parse(readFileSync(resolve(REPO_ROOT, NAMING_PARITY.file), 'utf8'));
const duplicates = NAMING_DUPLICATES.parse(readFileSync(resolve(REPO_ROOT, NAMING_DUPLICATES.file), 'utf8'));

interface Fixtures {
  raw: readonly SearchEntry[];
  constellations: { code: string; name: string }[];
  /** Indexed by record, read off the naming lineage. */
  labels: readonly string[];
  labelByKey: Map<string, string>;
  indexByKey: Map<string, number>;
}

async function loadFixtures(): Promise<Fixtures> {
  const catalog = await loadCatalog({ withSearchIndex: true });
  const constellations = readJson<{ code: string; name: string }[]>(publicFile(PUBLIC_FILES.constellations));
  const keys = ledgerKeys(readJson<RowIndexMap>(resolve(REPO_ROOT, BUILD_FILES.catalogRowIndexMap)));
  const labels = builtLabels(catalog, LINEAGE_LAYOUT.current);
  const labelByKey = new Map<string, string>();
  const indexByKey = new Map<string, number>();
  for (const [i, key] of keys) {
    labelByKey.set(key, labels[i]);
    indexByKey.set(key, i);
  }
  return { raw: catalog.searchIndex, constellations, labels, labelByKey, indexByKey };
}

// Read here, not in the describe body: vitest runs a skipped suite's factory
// to collect its tests, so a read inside it throws whatever the gate says.
const FIXTURES: Fixtures | null = FIXTURES_READY ? await loadFixtures() : null;

describe.runIf(FIXTURES_READY)('naming parity ledger', () => {
  it('the runtime composes, off the search index, every label the build decided', () => {
    // The browser composes designations at boot, so the wire must carry
    // enough to reach the build's decision; a record outside the search
    // index displays the runtime's Gaia DR3 / SID fallback.
    const { raw, constellations, labels } = FIXTURES!;
    const composed = displayNamesFromSearchIndex(raw, constellations);
    const inIndex = new Set(raw.map((e) => e.i));
    const drifted = labels.flatMap((built, i) => {
      const runtime = inIndex.has(i) ? composed.get(i)?.label ?? '' : '';
      return runtime === built ? [] : [`record ${i}: built "${built}", runtime "${runtime}"`];
    });
    expect(drifted.slice(0, 20)).toEqual([]);
  });

  it('every enumerated display change is exactly what the ladder composes', () => {
    const { labelByKey } = FIXTURES!;
    // Display changes are enumerated (/docs/star-naming.md#82-display-changes-are-enumerated), not counted. Reviewed once,
    // then pinned — a drift here means a record's label moved without the
    // ledger being refreshed (`pnpm run build:naming-parity`).
    const describe_ = (label: string | undefined) =>
      (label === undefined ? 'absent' : `"${label}"`);
    const drifted = parity
      .filter((row) => {
        const built = labelByKey.get(row.key);
        return row.record.present ? built !== row.record.new : built !== undefined;
      })
      .map((row) => `${row.key}: ledger ${
        describe_(row.record.present ? row.record.new : undefined)}, built ${
        describe_(labelByKey.get(row.key))}`);
    expect(drifted.slice(0, 20)).toEqual([]);
  });

  it('every ledger row is a change, keyed once', () => {
    // The pre-ladder label is knowable only from the committed `old`
    // column, so a change the ledger omits is unreachable from here — a
    // re-seed is what enumerates the set (README.md#the-parity-ledger).
    const enumerated = new Set(parity.map((row) => row.key));
    const missing: string[] = [];
    for (const row of parity) {
      if (row.record.present && row.old === row.record.new) {
        missing.push(`${row.key}: unchanged row in the ledger`);
      }
    }
    expect(missing.slice(0, 20)).toEqual([]);
    expect(enumerated.size).toBe(parity.length);
  });

  it('every published name resolves, and every displaced label as pinned', () => {
    // The searchability rule's hard invariant (/docs/star-naming.md#81-searchability-never-regresses), stated over the strings that HAVE external
    // provenance: every name the authority approves and every name the
    // manifest carries must reach a record. A string the build composed
    // itself has none, so the alias rule (/docs/star-naming.md#5-aliases--ship-what-cannot-be-derived-derive-what-can) lets it disappear with the composition —
    // which is what the ledger's `resolves` column enumerates, reviewed
    // once and pinned so a later change cannot quietly widen the set.
    const { raw, constellations, indexByKey } = FIXTURES!;
    const index = buildSearchIndex(raw, constellations);
    const byLabel = labelIndexOf(index);
    const anyRecord = (label: string): boolean =>
      byLabel.has(label.toLowerCase());

    const published = new Set<string>();
    for (const row of WGSN_NAMES.parse(readFileSync(WGSN_NAMES_PATH, 'utf8'))) {
      for (const spelling of [row.name, ...row.aliases]) published.add(spelling);
    }
    for (const r of MEMBERSHIP_MANIFEST.rows(readFileSync(MANIFEST, 'utf8'))) {
      if (r.proper !== null) published.add(r.proper);
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
      const idx = indexByKey.get(row.key);
      if (!row.record.present || idx === undefined) continue;
      const resolves = labelResolvesTo(index, byLabel, normalizeGlKey, row.old, idx);
      if (resolves !== row.record.resolves) {
        drifted.push(`${row.key}: "${row.old}" resolves=${resolves}, pinned ${row.record.resolves}`);
      }
    }
    expect(drifted.slice(0, 30)).toEqual([]);
  });

  it('duplicate composed labels are exactly the enumerated data findings', () => {
    // Known duplicate display names (/docs/star-naming.md#84-known-duplicate-display-names): the composer is injective given (naming anchor, component
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
