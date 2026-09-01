// Parity between the frozen spine and the AT-HYG-driven build it snapshots.
// See README.md § Parity with the shipped build.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { BUILD_COUNTS_EXPECTED_FILE, type BuildCounts } from '../build-counts';
import {
  DEFAULT_CATALOG_MANIFEST,
  DEFAULT_ROW_INDEX_MAP,
  DEFAULT_SEARCH_INDEX,
  loadCatalog,
} from '../catalog-lookup';
import { FLAG_BINARY_COMPANION_ONLY, type SearchEntry } from '../catalog-pure';
import { catalogRecordDesignations } from '../../sid/catalog-designations';
import {
  LABEL_FLIPS_FILE,
  labelFlipDesignationDelta,
  parseLabelFlipsTsv,
} from '../classic-ids/label-merge-pure';
import {
  PARKED_RECORDS_FILE,
  PARKED_REASONS,
  parkedSpineKey,
  parseParkedRecordsTsv,
} from '../distance/parallax/parked-ledger';
import { REPO_ROOT, isLfsPointer } from '../../util/paths';
import {
  INHERITED_SPINE_EXPECTED_FILE,
  INHERITED_SPINE_FILE,
  parseSpineTsv,
  spineDesignations,
  type SpineCounts,
} from './inherited-spine-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);

function readSnapshot<T>(repoRelative: string): T {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, repoRelative), 'utf-8')) as T;
}

const parkedLedger = parseParkedRecordsTsv(
  readFileSync(resolve(REPO_ROOT, PARKED_RECORDS_FILE), 'utf-8'),
);

describe('inherited spine ↔ shipped build record parity', () => {
  // Snapshot against snapshot: no artifacts, no LFS, so this runs in every
  // job. A record-build change that moves recordCount without regenerating
  // the spine breaks the membership term, and the count-only guard next
  // door cannot see it. See README.md § Parity with the shipped build.
  it('holds one row per AT-HYG-derived record of the shipped build, less the '
    + 'ledgered drops', () => {
    const build = readSnapshot<BuildCounts>(BUILD_COUNTS_EXPECTED_FILE);
    const spine = readSnapshot<SpineCounts>(INHERITED_SPINE_EXPECTED_FILE);
    expect(spine.rows).toBe(
      build.recordCount - build.companionPromoted + build.distNone,
    );
  });

  // § 6.1: no silent drops. The subtraction above is only honest while the
  // committed enumeration accounts for every row of it, so a drop count that
  // moves without a ledger entry fails here rather than passing as agreement.
  it('accounts for every dropped row in the committed § 6.1 ledger', () => {
    const build = readSnapshot<BuildCounts>(BUILD_COUNTS_EXPECTED_FILE);
    expect(parkedLedger).toHaveLength(build.distNone);
  });

  it('states a reason from the closed § 6.1 enum on every dropped row', () => {
    const codes = [...new Set(parkedLedger.map((r) => r.reason))].sort();
    expect(codes.filter((c) => !(PARKED_REASONS as readonly string[]).includes(c)))
      .toEqual([]);
  });

  // The five membership gates are the spine's own promises and stay at zero: a
  // park is a deliberate ledger entry, never a reference table having moved
  // under the snapshot. See ../parse/stars-parse.ts § ReadStarsDrops.
  it('drops no record through a membership gate', () => {
    const build = readSnapshot<BuildCounts>(BUILD_COUNTS_EXPECTED_FILE);
    expect([
      build.spineDroppedNoRaDec, build.spineDroppedNoDist,
      build.spineDroppedNoDirection, build.spineDroppedTooFar,
      build.spineDroppedNoVMagnitude,
    ]).toEqual([0, 0, 0, 0, 0]);
  });
});

const spineText = existsSync(SPINE_PATH) ? readFileSync(SPINE_PATH, 'utf-8') : null;
const spineAvailable = spineText !== null && !isLfsPointer(spineText);
// Needs a built catalogue as well as a smudged spine, so it runs in the
// build-catalog CI job and in any local tree that has run build:catalog.
const built = [DEFAULT_CATALOG_MANIFEST, DEFAULT_SEARCH_INDEX, DEFAULT_ROW_INDEX_MAP]
  .every(existsSync);

function tally(sets: Iterable<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const designation of set) {
      counts.set(designation, (counts.get(designation) ?? 0) + 1);
    }
  }
  return counts;
}

describe.skipIf(!spineAvailable || !built)(
  'inherited spine ↔ built catalogue designation parity',
  () => {
    let spineRecords = 0;
    let builtRecords = 0;
    let differences: string[] = [];

    beforeAll(async () => {
      const catalog = await loadCatalog();
      const searchIndex = JSON.parse(
        readFileSync(DEFAULT_SEARCH_INDEX, 'utf-8'),
      ) as SearchEntry[];
      const { bySynth } = JSON.parse(readFileSync(DEFAULT_ROW_INDEX_MAP, 'utf-8')) as {
        bySynth: Record<string, number>;
      };
      // Promotion's minted records are the build's non-AT-HYG-derived half and
      // carry this flag; the one AT-HYG double promotion merges instead of
      // twinning stays a primary, so it is on the spine side of the split.
      const derived = catalogRecordDesignations(catalog, searchIndex, bySynth)
        .filter((r) => (r.flags & FLAG_BINARY_COMPANION_ONLY) === 0);
      builtRecords = derived.length;
      const fromBuild = tally(derived.map((r) => r.designations));

      // The ledgered drops leave the built side by design, so they leave the
      // spine side here too — matched on the whole identifier tuple, which the
      // ledger and the spine carry under the same five column names.
      const parkedKeys = new Set(parkedLedger.map((r) => r.spineKey));
      const rows = parseSpineTsv(spineText!)
        .filter((row) => !parkedKeys.has(parkedSpineKey(row)));
      spineRecords = rows.length;
      const fromSpine = tally(rows.map(spineDesignations));

      // The classic-ID label layer moves designations off the spine's inherited
      // cells by design (docs/catalog-driver.md § 4), so the spine side is
      // replayed through the committed review queue — the complete enumeration
      // of that delta. Equality then still says every departure is accounted
      // for, which is what made "every SID is preserved" checkable.
      const delta = labelFlipDesignationDelta(
        parseLabelFlipsTsv(readFileSync(resolve(REPO_ROOT, LABEL_FLIPS_FILE), 'utf-8')),
      );
      for (const [designation, by] of delta) {
        fromSpine.set(designation, (fromSpine.get(designation) ?? 0) + by);
      }

      differences = [...new Set([...fromBuild.keys(), ...fromSpine.keys()])]
        .map((designation) => ({
          designation,
          build: fromBuild.get(designation) ?? 0,
          spine: fromSpine.get(designation) ?? 0,
        }))
        .filter((d) => d.build !== d.spine)
        .map((d) => `${d.designation}: build ${d.build}, spine ${d.spine}`)
        .sort();
    });

    it('covers the same records', () => {
      // Pinned against the snapshot too, so an artifact-shape change that
      // yields nothing on either side cannot pass as agreement.
      expect(spineRecords).toBe(
        readSnapshot<SpineCounts>(INHERITED_SPINE_EXPECTED_FILE).rows
          - parkedLedger.length,
      );
      expect(builtRecords).toBe(spineRecords);
    });

    it('resolves the spine multiset transformed by the label queue, so every SID is preserved', () => {
      expect(differences.slice(0, 20)).toEqual([]);
      expect(differences).toHaveLength(0);
    });
  },
);
