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
  BINDING_DISPOSITIONS_FILE,
  BINDING_REVIEW_FILE,
  COMPONENT_REASON_PREFIX,
  LABEL_DROPS_FILE,
  MEMBERSHIP_EXPECTED_FILE,
  MEMBERSHIP_MANIFEST_FILE,
  manifestDesignations,
  manifestKey,
  matchSpineToManifest,
  parseBindingDispositionsTsv,
  parseLabelDropsTsv,
  parseLedgerTsv,
  parseManifestTsv,
  type ManifestRow,
  type MembershipCounts,
  type SpineMatch,
} from './membership-manifest-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const MANIFEST_PATH = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
const LEDGER_PATH = resolve(REPO_ROOT, ADDITIONS_LEDGER_FILE);

const REVIEW_KEY_COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id'] as const;

function reviewRows(): Array<Record<(typeof REVIEW_KEY_COLUMNS)[number], string>> {
  return [...dataRows(
    readFileSync(resolve(REPO_ROOT, BINDING_REVIEW_FILE), 'utf-8'),
    REVIEW_KEY_COLUMNS, BINDING_REVIEW_FILE, 'Re-run `pnpm run build:membership`.',
  )].map(({ cells, idx }) => Object.fromEntries(
    REVIEW_KEY_COLUMNS.map((c) => [c, cells[idx[c]]]),
  ) as Record<(typeof REVIEW_KEY_COLUMNS)[number], string>);
}

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
  it('disposes every review-queue row, and nothing else', () => {
    const queue = reviewRows().map((r) => r.gaia_source_id).sort();
    expect([...dispositions.keys()].sort()).toEqual(queue);
    expect(queue).toHaveLength(expected.bindingReviewRows);
  });
});

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

  it('carries every kept review binding, and none the disposition dropped', () => {
    const byId = new Map(manifest.map((r) => [r.gaia_source_id, r]));
    for (const [id, d] of dispositions) {
      expect(byId.get(id)?.binding, id).toBe(d.disposition === 'keep' ? 'reviewed' : undefined);
    }
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
  // over the records the build produces. Until the record build reads the
  // manifest, that is the spine-origin rows less the parked ledger, and the
  // build still carries the bindings the manifest dropped to review and the
  // HD labels it dropped to the label ledger.
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
      const bump = (d: string): void => { fromManifest.set(d, (fromManifest.get(d) ?? 0) + 1); };
      for (const review of reviewRows()) {
        if (parked.has(parkedSpineKey(review))) continue;
        if (dispositions.get(review.gaia_source_id)?.disposition === 'keep') continue;
        bump(`gaia_dr3:${review.gaia_source_id}`);
      }
      const producedKeys = new Set(produced.map(manifestKey));
      for (const drop of parseLabelDropsTsv(readFileSync(resolve(REPO_ROOT, LABEL_DROPS_FILE), 'utf-8'))) {
        if (drop.cell === 'hd' && producedKeys.has(manifestKey(drop))) bump(`hd:${drop.value}`);
      }
      const diff = differences(fromBuild, fromManifest);
      expect(diff.slice(0, 20)).toEqual([]);
      expect(diff).toHaveLength(0);
    });
  });
});
