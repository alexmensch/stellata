// The floor over the committed pull and manifest. LFS-gated.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../../util/paths';
import { MEMBERSHIP_MANIFEST_FILE, iterManifestTsv } from '../membership-manifest-pure';
import {
  MAGNITUDE_PULL_TSV,
  readMagnitudeTerm,
  readMagnitudeTermAstrometry,
} from './magnitude-term';
import {
  magnitudeTermNewcomers,
  type MagnitudeTermSelection,
} from './magnitude-term-pure';

/** The floor the committed figures below were measured at. Distinct from
 *  MAGNITUDE_PULL_G_BOUND, which bounds the file rather than the term. */
const GATE_FLOOR_V = 11;

const MANIFEST_PATH = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
const readable = [MAGNITUDE_PULL_TSV, MANIFEST_PATH].every(lfsContentReadable);

describe.skipIf(!readable)('the floor over the committed pull', () => {
  let selection: MagnitudeTermSelection;
  let boundSourceIds: Set<string>;
  let committedTermRows: number;

  // The union's two sides are read apart, because the committed manifest is
  // the union — the term is ON. Deduping the kept set against the whole file
  // would measure the term against its own output and report zero newcomers.
  beforeAll(async () => {
    selection = await readMagnitudeTerm(GATE_FLOOR_V);
    boundSourceIds = new Set<string>();
    committedTermRows = 0;
    for (const row of iterManifestTsv(readFileSync(MANIFEST_PATH, 'utf8'))) {
      if (row.term === 'magnitude') { committedTermRows++; continue; }
      if (row.gaia_source_id) boundSourceIds.add(row.gaia_source_id);
    }
  }, 120_000);

  it('partitions the pull exactly as the measurement behind the floor does', () => {
    expect(selection.counts).toEqual({
      rows: 1_247_240,
      kept: 929_929,
      above_floor: 312_475,
      no_v: 4_836,
    });
  });

  it('unions onto the primaries at the record total the floor implies', () => {
    expect(boundSourceIds.size).toBe(370_994);
    const newcomers = magnitudeTermNewcomers(selection.keptSourceIds, boundSourceIds);
    expect(newcomers.length).toBe(602_228);
    expect(boundSourceIds.size + newcomers.length).toBe(973_222);
  });

  it('is the union the committed manifest already carries', () => {
    const newcomers = magnitudeTermNewcomers(selection.keptSourceIds, boundSourceIds);
    expect(committedTermRows).toBe(newcomers.length);
  });

  it('keeps 327,701 sources the primaries already bind', () => {
    let both = 0;
    for (const sourceId of selection.keptSourceIds) {
      if (boundSourceIds.has(sourceId)) both++;
    }
    expect(both).toBe(327_701);
  });

  it('reads the 5p astrometry of exactly the sources it is handed', async () => {
    const keep = new Set([...selection.keptSourceIds].slice(0, 500));
    const rows = await readMagnitudeTermAstrometry(keep);
    expect(new Set(rows.keys())).toEqual(keep);
    for (const row of rows.values()) {
      expect(Number.isFinite(row.raDeg) && Number.isFinite(row.decDeg)).toBe(true);
    }
  }, 120_000);

  it('reads nothing for an empty keep-set', async () => {
    expect((await readMagnitudeTermAstrometry(new Set())).size).toBe(0);
  });
});
