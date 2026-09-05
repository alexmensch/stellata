// The replacement parity gate over the committed membership artifacts:
// spine → manifest (i), additions ledger (ii), built catalogue (iii).
// See README.md § The parity gate.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { OVERRIDES_PATH } from '../../sid/registry-io';
import { catalogRecordDesignations } from '../../sid/catalog-designations';
import { parseSameasTsv } from '../../sid/sid-pure';
import {
  DEFAULT_CATALOG_MANIFEST,
  DEFAULT_ROW_INDEX_MAP,
  DEFAULT_SEARCH_INDEX,
  loadCatalog,
} from '../catalog-lookup';
import { FLAG_BINARY_COMPANION_ONLY, type SearchEntry } from '../catalog-pure';
import { dataRows } from '../parse/corpus-tsv';
import {
  PARKED_RECORDS_FILE,
  parkedSpineKey,
  parseParkedRecordsTsv,
} from '../distance/parallax/parked-ledger';
import {
  INHERITED_SPINE_FILE,
  parseSpineTsv,
  spineDesignations,
  type SpineRow,
} from '../spine/inherited-spine-pure';
import {
  ADDITIONS_LEDGER_FILE,
  ADDITION_REASONS,
  BINDING_REVIEW_FILE,
  COMPONENT_REASON_PREFIX,
  MEMBERSHIP_EXPECTED_FILE,
  MEMBERSHIP_MANIFEST_FILE,
  manifestDesignations,
  manifestKey,
  matchSpineToManifest,
  parseLedgerTsv,
  parseManifestTsv,
  type ManifestRow,
  type MembershipCounts,
  type SpineMatch,
} from './membership-manifest-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const MANIFEST_PATH = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
const LEDGER_PATH = resolve(REPO_ROOT, ADDITIONS_LEDGER_FILE);

const inputsReadable = [SPINE_PATH, MANIFEST_PATH, LEDGER_PATH].every(lfsContentReadable);
const built = [DEFAULT_CATALOG_MANIFEST, DEFAULT_SEARCH_INDEX, DEFAULT_ROW_INDEX_MAP]
  .every(existsSync);

const expected = JSON.parse(
  readFileSync(resolve(REPO_ROOT, MEMBERSHIP_EXPECTED_FILE), 'utf-8'),
) as MembershipCounts;

function tally(sets: Iterable<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const d of set) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

function differences(a: Map<string, number>, b: Map<string, number>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((d) => (a.get(d) ?? 0) !== (b.get(d) ?? 0))
    .map((d) => `${d}: ${a.get(d) ?? 0} vs ${b.get(d) ?? 0}`)
    .sort();
}

// The three inputs ride LFS, so the bare CI `test` job sees pointer stubs and
// this self-skips; it runs smudged in tier-a-corpus, which names this file.
describe.skipIf(!inputsReadable)('membership manifest ↔ inherited spine', () => {
  let spine: SpineRow[];
  let manifest: ManifestRow[];
  let match: SpineMatch;

  beforeAll(() => {
    spine = parseSpineTsv(readFileSync(SPINE_PATH, 'utf-8'));
    manifest = parseManifestTsv(readFileSync(MANIFEST_PATH, 'utf-8'));
    match = matchSpineToManifest(
      spine.map(spineDesignations),
      manifest,
      parseSameasTsv(readFileSync(OVERRIDES_PATH, 'utf-8'), 'sameas-overrides.tsv'),
    );
  });

  it('matches the pinned row counts', () => {
    expect(manifest).toHaveLength(expected.rows);
    expect(spine).toHaveLength(expected.spineRows);
  });

  // (i) Every spine row resolves through its designation class to exactly one
  // manifest row — the same SID by construction. The retirement drops no
  // record (docs/catalog-driver.md § 3.1: the residual is zero), so there is
  // no drop list for a spine row to land on instead.
  it('(i) maps every spine row to exactly one manifest row', () => {
    expect(match.unmatched.slice(0, 20).map((i) => spine[i])).toEqual([]);
    expect(match.multiple.slice(0, 20).map((i) => spine[i])).toEqual([]);
    const targets = match.manifestIndex.filter((i): i is number => i !== null);
    expect(new Set(targets).size).toBe(targets.length);
  });

  // (ii) Every manifest row no spine row reaches is on the additions ledger
  // under a closed reason, and every ledger row is one of those — or a
  // `component:` row naming the manifest record it resolved onto.
  it('(ii) ledgers every addition, and nothing else, under the § 6.1 enum', () => {
    const ledger = parseLedgerTsv(readFileSync(LEDGER_PATH, 'utf-8'));
    const admitted = ledger.filter((l) => !l.reason.startsWith(COMPONENT_REASON_PREFIX));
    const components = ledger.filter((l) => l.reason.startsWith(COMPONENT_REASON_PREFIX));

    const unreachedKeys = match.unreached.map((i) => manifestKey(manifest[i])).sort();
    expect(admitted.map(manifestKey).sort()).toEqual(unreachedKeys);
    for (const l of admitted) {
      expect((ADDITION_REASONS as readonly string[]).includes(l.reason), l.reason).toBe(true);
    }
    const byReason = new Map<string, number>();
    for (const l of admitted) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + 1);
    expect(Object.fromEntries(byReason)).toEqual(expected.additionsByReason);

    const manifestKeys = new Set(manifest.map(manifestKey));
    const manifestTycs = new Set(manifest.map((r) => r.tyc).filter((t) => t !== ''));
    const designations = new Set(manifest.flatMap(manifestDesignations));
    expect(components).toHaveLength(expected.componentRows);
    for (const c of components) {
      expect(manifestKeys.has(manifestKey(c)), `component row is a manifest row: ${c.tyc}`).toBe(false);
      if (c.tyc !== '') expect(manifestTycs.has(c.tyc), `component TYC admitted: ${c.tyc}`).toBe(false);
      const anchor = c.reason.slice(COMPONENT_REASON_PREFIX.length);
      expect(designations.has(anchor), `anchor ${anchor} is a manifest designation`).toBe(true);
    }
  });

  it('keys every row on a designation and carries no duplicate source_id', () => {
    const ids = manifest.map((r) => r.gaia_source_id).filter((s) => s !== '');
    expect(new Set(ids).size).toBe(ids.length);
    expect(manifest.filter((r) => manifestDesignations(r).length === 0)).toEqual([]);
    expect(manifest.filter((r) => manifestDesignations(r).includes('sol:sun'))).toHaveLength(1);
  });

  it('holds the review queue to the pinned size', () => {
    const rows = readFileSync(resolve(REPO_ROOT, BINDING_REVIEW_FILE), 'utf-8')
      .trimEnd().split('\n').length - 1;
    expect(rows).toBe(expected.bindingReviewRows);
  });

  // (iii) The built catalogue's designation multiset equals the manifest's
  // over the records the build produces. Until the record build reads the
  // manifest, that is the spine-origin rows less the parked ledger, and the
  // build still carries the bindings the manifest sent to review.
  describe.skipIf(!built)('↔ built catalogue', () => {
    it('(iii) ships exactly the manifest\'s designations', async () => {
      const catalog = await loadCatalog();
      const searchIndex = JSON.parse(readFileSync(DEFAULT_SEARCH_INDEX, 'utf-8')) as SearchEntry[];
      const { bySynth } = JSON.parse(readFileSync(DEFAULT_ROW_INDEX_MAP, 'utf-8')) as {
        bySynth: Record<string, number>;
      };
      const fromBuild = tally(
        catalogRecordDesignations(catalog, searchIndex, bySynth)
          .filter((r) => (r.flags & FLAG_BINARY_COMPANION_ONLY) === 0)
          .map((r) => r.designations),
      );
      const parked = new Set(parseParkedRecordsTsv(
        readFileSync(resolve(REPO_ROOT, PARKED_RECORDS_FILE), 'utf-8'),
      ).map((r) => r.spineKey));
      const produced: ManifestRow[] = [];
      spine.forEach((row, s) => {
        const i = match.manifestIndex[s];
        if (i !== null && !parked.has(parkedSpineKey(row))) produced.push(manifest[i]);
      });
      const fromManifest = tally(produced.map(manifestDesignations));
      for (const { cells, idx } of dataRows(
        readFileSync(resolve(REPO_ROOT, BINDING_REVIEW_FILE), 'utf-8'),
        ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id'], BINDING_REVIEW_FILE,
        'Re-run `pnpm run build:membership`.',
      )) {
        const review = Object.fromEntries(
          (['tyc', 'hip', 'hd', 'gl', 'gaia_source_id'] as const).map((c) => [c, cells[idx[c]]]),
        ) as Record<'tyc' | 'hip' | 'hd' | 'gl' | 'gaia_source_id', string>;
        if (parked.has(parkedSpineKey(review))) continue;
        const d = `gaia_dr3:${review.gaia_source_id}`;
        fromManifest.set(d, (fromManifest.get(d) ?? 0) + 1);
      }
      const diff = differences(fromBuild, fromManifest);
      expect(diff.slice(0, 20)).toEqual([]);
      expect(diff).toHaveLength(0);
    });
  });
});
