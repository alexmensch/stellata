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
import { isLfsPointer } from '../../sid/sid-pure';
import { REPO_ROOT } from '../../util/paths';
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

describe('inherited spine ↔ shipped build record parity', () => {
  // Snapshot against snapshot: no artifacts, no LFS, so this runs in every
  // job. A record-build change that moves recordCount without regenerating
  // the spine breaks the membership term stellata-3bsf.4 swaps in, and the
  // count-only guard next door cannot see it.
  it('holds one row per AT-HYG-derived record of the shipped build', () => {
    const build = readSnapshot<BuildCounts>(BUILD_COUNTS_EXPECTED_FILE);
    const spine = readSnapshot<SpineCounts>(INHERITED_SPINE_EXPECTED_FILE);
    expect(spine.rows).toBe(build.recordCount - build.companionPromoted);
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

      const rows = parseSpineTsv(spineText!);
      spineRecords = rows.length;
      const fromSpine = tally(rows.map(spineDesignations));

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
      expect(spineRecords).toBe(readSnapshot<SpineCounts>(INHERITED_SPINE_EXPECTED_FILE).rows);
      expect(builtRecords).toBe(spineRecords);
    });

    it('resolves the identical designation multiset, so every SID is preserved', () => {
      expect(differences.slice(0, 20)).toEqual([]);
      expect(differences).toHaveLength(0);
    });
  },
);
