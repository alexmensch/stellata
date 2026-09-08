// The replacement parity gate over the committed membership artifacts:
// spine → manifest (i), additions ledger (ii), built catalogue (iii).
// See README.md § The parity gate.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { OVERRIDES_PATH } from '../../sid/registry-io';
import { catalogRecordDesignations } from '../../sid/catalog-designations';
import { canonicalKeyOf, compareDesignations, parseSameasTsv } from '../../sid/sid-pure';
import {
  DEFAULT_CATALOG_MANIFEST,
  DEFAULT_ROW_INDEX_MAP,
  DEFAULT_SEARCH_INDEX,
  loadCatalog,
} from '../catalog-lookup';
import { FLAG_BINARY_COMPANION_ONLY, type SearchEntry } from '../catalog-pure';
import {
  PARKED_LEDGER_FILE,
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
  BINDING_DISPOSITIONS_FILE,
  BINDING_REVIEW_FILE,
  COMPONENT_REASON_PREFIX,
  LABEL_DROPS_FILE,
  MEMBERSHIP_EXPECTED_FILE,
  MEMBERSHIP_MANIFEST_FILE,
  SPINE_CORRECTIONS_FILE,
  applySpineCorrections,
  bindingReviewKey,
  manifestDesignations,
  manifestKey,
  matchSpineToManifest,
  parseBindingDispositionsTsv,
  parseBindingReviewTsv,
  parseLabelDropsTsv,
  parseSpineCorrectionsTsv,
  parseLedgerTsv,
  parseManifestTsv,
  type ManifestRow,
  type SpineFold,
  type MembershipCounts,
  type SpineMatch,
} from './membership-manifest-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const MANIFEST_PATH = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
const LEDGER_PATH = resolve(REPO_ROOT, ADDITIONS_LEDGER_FILE);
const CORRECTIONS_PATH = resolve(REPO_ROOT, SPINE_CORRECTIONS_FILE);

const queue = parseBindingReviewTsv(readFileSync(resolve(REPO_ROOT, BINDING_REVIEW_FILE), 'utf-8'));
const dispositions = parseBindingDispositionsTsv(
  readFileSync(resolve(REPO_ROOT, BINDING_DISPOSITIONS_FILE), 'utf-8'),
);

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

// Both files are regular git, so this runs in every job.
describe('binding review dispositions', () => {
  it('disposes every review-queue row, and nothing else, on the ids the row states', () => {
    expect([...dispositions.keys()].sort()).toEqual(queue.map(bindingReviewKey).sort());
    expect(queue).toHaveLength(expected.bindingReviewRows);
    for (const row of queue) {
      const d = dispositions.get(bindingReviewKey(row))!;
      expect([d.frozen_source_id, d.derived_source_id], bindingReviewKey(row))
        .toEqual([row.frozen_source_id, row.derived_source_id]);
    }
    const byVerdict = new Map<string, number>();
    for (const row of queue) byVerdict.set(row.verdict, (byVerdict.get(row.verdict) ?? 0) + 1);
    expect(Object.fromEntries(byVerdict)).toEqual(
      Object.fromEntries(Object.entries(expected.bindingReviewByVerdict).filter(([, n]) => n > 0)),
    );
  });
});

// The three inputs ride LFS, so the bare CI `test` job sees pointer stubs and
// this self-skips; it runs smudged in tier-a-corpus, which names this file.
describe.skipIf(!inputsReadable)('membership manifest ↔ inherited spine', () => {
  let spine: SpineRow[];
  /** Every spine row with its corrected cells, in file order — the keys a
   *  disposition joins on once a correction has moved one. */
  let corrected: SpineRow[];
  let folds: SpineFold[];
  let manifest: ManifestRow[];
  let match: SpineMatch;

  beforeAll(() => {
    spine = parseSpineTsv(readFileSync(SPINE_PATH, 'utf-8'));
    ({ corrected, folds } = applySpineCorrections(
      spine,
      parseSpineCorrectionsTsv(readFileSync(CORRECTIONS_PATH, 'utf-8')),
    ));
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
  //
  // A FOLD is the one way two spine rows may share a manifest row, and
  // spine-corrections.tsv says exactly which pairs: the count is pinned and
  // each pair is checked, so a fold cannot arrive by any other route and a
  // second row landing on someone else's record still fails here.
  it('(i) maps every spine row to exactly one manifest row', () => {
    expect(match.unmatched.slice(0, 20).map((i) => spine[i])).toEqual([]);
    expect(match.multiple.slice(0, 20).map((i) => spine[i])).toEqual([]);
    const targets = match.manifestIndex.filter((i): i is number => i !== null);
    expect(targets.length - new Set(targets).size).toBe(expected.spineRowsFolded);
    expect(folds).toHaveLength(expected.spineRowsFolded);
    for (const { foldedRow, survivorRow } of folds) {
      expect(match.manifestIndex[foldedRow], bindingReviewKey(spine[foldedRow]))
        .toBe(match.manifestIndex[survivorRow]);
      expect(match.manifestIndex[foldedRow]).not.toBeNull();
    }
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

  // A designation two rows carry keys neither of them (docs/sid.md § 4.1), so
  // the row it would have keyed falls to its next rung — the Gaia id, or
  // nothing. Admission refuses one an existing record answers to, which leaves
  // the spine's own pairs: those key on a HIP the merge left alone, and the
  // count pins them so a label change that makes a new one is visible.
  it('admits no designation another record already answers to', () => {
    const owners = new Map<string, number[]>();
    manifest.forEach((row, i) => {
      for (const d of new Set(manifestDesignations(row))) {
        const list = owners.get(d);
        if (list) list.push(i);
        else owners.set(d, [i]);
      }
    });
    const additions = new Set(match.unreached);
    const shared = [...owners].filter(([, rows]) => rows.length > 1);
    const reachingAnAddition = shared
      .filter(([, rows]) => rows.some((i) => additions.has(i)))
      .map(([d, rows]) => `${d}: ${rows.map((i) => manifest[i].tyc || '(no tyc)').join(', ')}`);
    expect(reachingAnAddition.slice(0, 20)).toEqual([]);
    expect(shared).toHaveLength(expected.sharedDesignations);
  });

  // Every disposed row ships the value its disposition settled on, under
  // `reviewed`, or none — and no `reviewed` binding exists without one.
  it('carries every disposed binding as reviewed, and no other', () => {
    // Keyed on the CORRECTED cells: a disposition adjudicates the row the
    // generator derived from, and a `set` correction moves that key.
    const bySpineKey = new Map<string, ManifestRow>();
    corrected.forEach((row, i) => {
      const target = match.manifestIndex[i];
      if (target !== null) bySpineKey.set(bindingReviewKey(row), manifest[target]);
    });
    for (const [key, d] of dispositions) {
      const row = bySpineKey.get(key)!;
      const value = d.keep_source_id;
      expect([row.gaia_source_id, row.binding], key)
        .toEqual([value, value === '' ? 'none' : 'reviewed']);
    }
    expect(manifest.filter((r) => r.binding === 'reviewed')).toHaveLength(
      [...dispositions.values()].filter((d) => d.keep_source_id !== '').length,
    );
  });

  // § 6.2: every spine label the manifest leaves out is on the label ledger,
  // keyed on the manifest row it left, under a closed reason.
  it('ledgers every dropped spine label onto its manifest row', () => {
    const drops = parseLabelDropsTsv(readFileSync(resolve(REPO_ROOT, LABEL_DROPS_FILE), 'utf-8'));
    const manifestKeys = new Set(manifest.map(manifestKey));
    for (const d of drops) {
      expect(manifestKeys.has(manifestKey(d)), `label drop keys a manifest row: ${manifestKey(d)}`).toBe(true);
      expect(['hd', 'flam']).toContain(d.cell);
    }
    const byReason = new Map<string, number>();
    for (const d of drops) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
    expect(Object.fromEntries(byReason)).toEqual(expected.labelDropsByReason);
  });

  // A dropped label is a designation leaving a record, so § 7 asks whether it
  // was the one keying it. A Flamsteed number is no designation at all, and an
  // HD only keys a record no higher-laddered cell reaches — but "the row that
  // lost one happened to carry a HIP" is a fact about today's data, not a rule.
  // This is the rule: whatever keys the row now already outranked the cell it
  // lost, so the drop cannot have moved a canonical key.
  it('drops no label that was keying its record', () => {
    const drops = parseLabelDropsTsv(readFileSync(resolve(REPO_ROOT, LABEL_DROPS_FILE), 'utf-8'));
    const byKey = new Map(manifest.map((r) => [manifestKey(r), r]));
    const moved: string[] = [];
    for (const d of drops) {
      if (d.cell === 'flam') {
        expect(manifestDesignations(byKey.get(manifestKey(d))!)
          .some((x) => x.startsWith('flam:'))).toBe(false);
        continue;
      }
      const key = canonicalKeyOf(manifestDesignations(byKey.get(manifestKey(d))!));
      if (compareDesignations(key, `hd:${d.value}`) >= 0) moved.push(`${key} vs hd:${d.value}`);
    }
    expect(moved).toEqual([]);
  });

  // (iii) The built catalogue's designation multiset equals the manifest's
  // over the records the build produces: every manifest row less the parked
  // ledger, matched on the five identifier cells both files carry.
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
        readFileSync(resolve(REPO_ROOT, PARKED_LEDGER_FILE), 'utf-8'),
      ).map((r) => r.recordKey));
      const fromManifest = tally(
        manifest.filter((row) => !parked.has(manifestKey(row))).map(manifestDesignations),
      );
      const diff = differences(fromBuild, fromManifest);
      expect(diff.slice(0, 20)).toEqual([]);
      expect(diff).toHaveLength(0);
    });
  });
});
