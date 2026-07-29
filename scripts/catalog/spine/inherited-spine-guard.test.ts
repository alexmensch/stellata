// Guard over the committed data/athyg/inherited-spine.tsv. The spine is
// frozen, so nothing regenerates it in CI — these assertions are what keeps
// the artifact honest instead. See README.md § Why a guard, not a rebuild.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { compareBuildCounts } from '../build-counts';
import { REPO_ROOT, isLfsPointer } from '../../util/paths';
import {
  INHERITED_SPINE_EXPECTED_FILE,
  INHERITED_SPINE_FILE,
  SPINE_COLUMNS,
  parseSpineTsv,
  spineCounts,
  spineDesignations,
  type SpineCounts,
  type SpineRow,
} from './inherited-spine-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const EXPECTED_PATH = resolve(REPO_ROOT, INHERITED_SPINE_EXPECTED_FILE);

/** The frozen artifact's byte identity, pinned in test source rather than in
 *  the count snapshot: `UPDATE_BUILD_COUNTS=1` rewrites that snapshot, so a
 *  regeneration would otherwise refresh its own guard. Changing these two
 *  literals is the deliberate act that unfreezes the spine. */
const FROZEN_BYTES = 42_426_957;
const FROZEN_SHA256 = '1036074d24d902ebedc0ff40fc3302821988b9be079adc3f60cfc1a8d8cc1a1a';

const bytes = existsSync(SPINE_PATH) ? readFileSync(SPINE_PATH) : null;
const text = bytes?.toString('utf-8') ?? null;
// The spine rides LFS: a checkout without LFS smudging (the bare CI `test`
// job) sees a pointer stub. This runs for real in the build-catalog job
// (lfs: true) and in any local clone.
const available = text !== null && !isLfsPointer(text);

describe.skipIf(!available)('committed inherited spine', () => {
  // Parsed in beforeAll, not in the describe body: a skipped suite still runs
  // its body to collect tests, so parsing there would hit the pointer stub the
  // skip exists to avoid — and it keeps the 40 MB parse to once per run.
  let rows: SpineRow[];
  beforeAll(() => { rows = parseSpineTsv(text!); });

  it('is byte-for-byte the frozen artifact', () => {
    expect(bytes!.byteLength).toBe(FROZEN_BYTES);
    expect(createHash('sha256').update(bytes!).digest('hex')).toBe(FROZEN_SHA256);
  });

  it('matches the pinned row + per-column counts', () => {
    const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8')) as SpineCounts;
    const mismatches = compareBuildCounts(expected, spineCounts(rows))
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
