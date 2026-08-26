// Guard over the committed data/athyg/inherited-spine.tsv. The spine is
// frozen, so nothing regenerates it in CI — these assertions are what keeps
// the artifact honest instead. See README.md § Why a guard, not a rebuild.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { compareBuildCounts } from '../build-counts';
import { dataRows } from '../parse/corpus-tsv';
import { REPO_ROOT, isLfsPointer, lfsContentReadable } from '../../util/paths';
import {
  INHERITED_SPINE_EXPECTED_FILE,
  INHERITED_SPINE_FILE,
  SPINE_COLUMNS,
  STALE_GAIA_SOURCE_IDS_FILE,
  parseSpineTsv,
  spineCounts,
  spineDesignations,
  type SpineCounts,
  type SpineRow,
} from './inherited-spine-pure';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);
const EXPECTED_PATH = resolve(REPO_ROOT, INHERITED_SPINE_EXPECTED_FILE);
const ASTROMETRY_PATH = resolve(
  REPO_ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv',
);
const SIMBAD_VALUES_PATH = resolve(REPO_ROOT, 'data/simbad/simbad_values.tsv');

const STALE_QUEUE_COLUMNS = [
  'gaia_source_id', 'simbad_oid', 'simbad_dr3_source_id',
] as const;
const STALE_QUEUE_HINT =
  'Re-derive it from the spine, the 5p pull and the SIMBAD values pull.';

/** Key column of a big TSV, without materialising the rest of the row — both
 *  files here run to hundreds of thousands of lines and only the first cell
 *  is read. */
function* firstColumn(text: string): Generator<string> {
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    yield line.slice(0, line.indexOf('\t'));
  }
}

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

// Needs the 5p pull and the SIMBAD values pull as well as the spine, so it
// gates on all three rather than reusing the block above.
const staleInputs = [SPINE_PATH, ASTROMETRY_PATH, SIMBAD_VALUES_PATH];

describe.skipIf(!staleInputs.every(lfsContentReadable))(
  'spine source_ids Gaia DR3 publishes no row for',
  () => {
    let queue: Record<string, string>[];
    let published: Set<string>;
    let reachedOids: Set<string>;

    beforeAll(() => {
      queue = [...dataRows(
        readFileSync(resolve(REPO_ROOT, STALE_GAIA_SOURCE_IDS_FILE), 'utf-8'),
        STALE_QUEUE_COLUMNS, STALE_GAIA_SOURCE_IDS_FILE, STALE_QUEUE_HINT,
      )].map(({ cells, idx }) => Object.fromEntries(
        STALE_QUEUE_COLUMNS.map((c) => [c, (cells[idx[c]] ?? '').trim()]),
      ));
      published = new Set(firstColumn(readFileSync(ASTROMETRY_PATH, 'utf-8')));
      reachedOids = new Set(firstColumn(readFileSync(SIMBAD_VALUES_PATH, 'utf-8')));
    });

    it('enumerates exactly the spine rows the 5p pull cannot key', () => {
      const unpublished = parseSpineTsv(text!)
        .map((r) => r.gaia_source_id)
        .filter((id) => id !== '' && !published.has(id));
      expect(new Set(unpublished)).toEqual(new Set(queue.map((r) => r.gaia_source_id)));
    });

    it('reaches every one of them through a widened SIMBAD namespace', () => {
      const unreached = queue.filter((r) => !reachedOids.has(r.simbad_oid));
      expect(unreached).toEqual([]);
    });

    // A successor id that were also a spine cell would put two records on one
    // SIMBAD row, which the values parser rejects as a duplicate key rather
    // than arbitrating. Kept as a stated invariant, not an observation.
    it('names no successor id the spine already carries', () => {
      const spineIds = new Set(parseSpineTsv(text!).map((r) => r.gaia_source_id));
      const collisions = queue
        .map((r) => r.simbad_dr3_source_id)
        .filter((id) => id !== '' && spineIds.has(id));
      expect(collisions).toEqual([]);
    });
  },
);
