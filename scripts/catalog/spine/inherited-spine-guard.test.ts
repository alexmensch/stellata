// Guard over the committed data/athyg/inherited-spine.tsv. The spine is
// frozen, so nothing regenerates it in CI — these assertions are what keeps
// the artifact honest instead. See README.md § Why a guard, not a rebuild.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compareBuildCounts } from '../build-counts';
import { REPO_ROOT } from '../../util/paths';
import { isLfsPointer } from '../../sid/sid-pure';
import {
  INHERITED_SPINE_FILE,
  SPINE_COLUMNS,
  parseSpineTsv,
  spineCounts,
  spineDesignations,
  type SpineCounts,
} from './inherited-spine-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const EXPECTED_PATH = resolve(REPO_ROOT, 'scripts/catalog/spine/inherited-spine-expected.json');

const text = existsSync(SPINE_PATH) ? readFileSync(SPINE_PATH, 'utf-8') : null;
// The spine rides LFS: a checkout without LFS smudging (the bare CI `test`
// job) sees a pointer stub. This runs for real in the build-catalog job
// (lfs: true) and in any local clone.
const available = text !== null && !isLfsPointer(text);

describe.skipIf(!available)('committed inherited spine', () => {
  const rows = parseSpineTsv(text!);
  const counts = spineCounts(rows);
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8')) as SpineCounts;

  it('matches the pinned row + per-column counts', () => {
    const mismatches = compareBuildCounts(expected, counts)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([]);
  });

  it('gives every row a designation, so no row is keyless for SID resolution', () => {
    const keyless = rows.filter((r) => spineDesignations(r).length === 0);
    expect(keyless).toEqual([]);
  });

  it('holds exactly one Sol record', () => {
    expect(rows.filter((r) => spineDesignations(r).includes('sol:sun'))).toHaveLength(1);
  });

  it('carries no duplicate Gaia source_id', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const r of rows) {
      const id = r.gaia_source_id;
      if (id === '') continue;
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    expect(duplicates).toEqual([]);
  });

  it('keeps every cell free of TSV delimiters', () => {
    const offenders = rows.flatMap((r, i) => SPINE_COLUMNS
      .filter((c) => /[\t\r]/.test(r[c]))
      .map((c) => `row ${i} ${c}`));
    expect(offenders).toEqual([]);
  });
});
