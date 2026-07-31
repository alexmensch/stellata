// The designation-constellation cascade, pinned against the BUILT search
// index. See README.md § The designation constellation.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUILD_COUNTS_EXPECTED_FILE, type BuildCounts } from '../build-counts';
import { DEFAULT_SEARCH_INDEX } from '../catalog-lookup';
import type { SearchEntry } from '../catalog-pure';
import { CON_INDEX } from '../parse/constellations';
import { REPO_ROOT } from '../../util/paths';

const built = existsSync(DEFAULT_SEARCH_INDEX);

describe.skipIf(!built)('designation constellation on the wire', () => {
  const index = built
    ? (JSON.parse(readFileSync(DEFAULT_SEARCH_INDEX, 'utf-8')) as SearchEntry[])
    : [];
  const byHip = new Map(index.filter((e) => e.hip !== undefined).map((e) => [e.hip!, e]));
  const byHd = new Map(index.filter((e) => e.hd !== undefined).map((e) => [e.hd!, e]));
  const con = (code: string): number => {
    const i = CON_INDEX.get(code);
    if (i === undefined) throw new Error(`no constellation "${code}"`);
    return i;
  };

  // The star the desigConIndex / conIndex split exists for: proper motion
  // carried it into Delphinus in 1992 and every catalogue still calls it
  // ρ Aquilae. Losing this pin means it searches as "Rho Del" again, which is
  // how the regression shipped once already.
  it('gives ρ Aql / 67 Aql its Aquila designation, not its Delphinus position', () => {
    const entry = byHip.get(99742);
    expect(entry?.b).toBe('Rho');
    expect(entry?.f).toBe(67);
    expect(entry?.c).toBe(con('del'));
    expect(entry?.dc).toBe(con('aql'));
  });

  // Flamsteed numbered per Ptolemaic constellation, so the 1930 Delporte
  // boundaries left a whole population like this one behind. IV/27A is the
  // authority for it, and nothing in the record's own position can be.
  it('keeps 15 LMi in Leo Minor though it sits in Ursa Major', () => {
    const entry = byHd.get(84737);
    expect(entry?.f).toBe(15);
    expect(entry?.c).toBe(con('uma'));
    expect(entry?.dc).toBe(con('lmi'));
  });

  // A promoted companion composes its name off the anchor's designation, so
  // the anchor's constellation has to reach it — and Fomalhaut is exactly the
  // bright star the source_id-keyed overlay cannot carry (Gaia saturates near
  // G ≈ 3), which is why this cascade keys on HD/HIP instead.
  it('names Fomalhaut C for Piscis Austrinus, not its own Aquarius position', () => {
    const entry = index.find((e) => e.p === 'Fomalhaut C');
    expect(entry?.c).toBe(con('aqr'));
    expect(entry?.dc).toBe(con('psa'));
  });

  it('emits dc on exactly the pinned population', () => {
    const expected = JSON.parse(
      readFileSync(resolve(REPO_ROOT, BUILD_COUNTS_EXPECTED_FILE), 'utf-8'),
    ) as BuildCounts;
    expect(index.filter((e) => e.dc !== undefined)).toHaveLength(
      expected.designationConMismatch,
    );
  });
});
