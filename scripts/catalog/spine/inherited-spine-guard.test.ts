// Guard over the committed data/athyg/inherited-spine.tsv. The spine is
// frozen, so nothing regenerates it in CI — these assertions are what keeps
// the artifact honest instead. See README.md#why-a-guard-not-a-rebuild.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { compareCountSnapshot } from '../build-counts';
import { GAIA_ASTROMETRY } from '../distance/gaia-astrometry-source';
import { SIMBAD_VALUES } from '../simbad/simbad-values-source';
import { REPO_ROOT, isLfsPointer } from '../../util/paths';
import { isReadable, openDeclared, type Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import {
  INHERITED_SPINE_EXPECTED_FILE,
  SPINE_COLUMNS,
  spineCounts,
  spineDesignations,
  type SpineCounts,
  type SpineRow,
} from './inherited-spine-pure';
import { INHERITED_SPINE } from './inherited-spine-tsv';
import { STALE_GAIA_SOURCE_IDS } from './stale-gaia-source-ids-source';

const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE.file);
const EXPECTED_PATH = resolve(REPO_ROOT, INHERITED_SPINE_EXPECTED_FILE);

function* keyColumn(declared: Declared, column: string): Generator<string> {
  for (const row of readTable({ ...declared, columns: [column] }, openDeclared(declared).text())) {
    yield row.raw(column);
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
  beforeAll(() => { rows = INHERITED_SPINE.parse(text!); });

  it('is byte-for-byte the frozen artifact', () => {
    expect(bytes!.byteLength).toBe(FROZEN_BYTES);
    expect(createHash('sha256').update(bytes!).digest('hex')).toBe(FROZEN_SHA256);
  });

  it('matches the pinned row + per-column counts', () => {
    const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8')) as SpineCounts;
    const { drifted, report } = compareCountSnapshot(expected, spineCounts(rows));
    expect(drifted, report).toBe(false);
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
const staleInputs: readonly Declared[] = [INHERITED_SPINE, GAIA_ASTROMETRY, SIMBAD_VALUES];

describe.skipIf(!staleInputs.every(isReadable))(
  'spine source_ids Gaia DR3 publishes no row for',
  () => {
    let queue: Record<string, string>[];
    let published: Set<string>;
    let reachedOids: Set<string>;

    beforeAll(() => {
      queue = STALE_GAIA_SOURCE_IDS.read();
      published = new Set(keyColumn(GAIA_ASTROMETRY, 'source_id'));
      reachedOids = new Set(keyColumn(SIMBAD_VALUES, 'simbad_oid'));
    });

    it('enumerates exactly the spine rows the 5p pull cannot key', () => {
      const unpublished = INHERITED_SPINE.parse(text!)
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
      const spineIds = new Set(INHERITED_SPINE.parse(text!).map((r) => r.gaia_source_id));
      const collisions = queue
        .map((r) => r.simbad_dr3_source_id)
        .filter((id) => id !== '' && spineIds.has(id));
      expect(collisions).toEqual([]);
    });
  },
);
