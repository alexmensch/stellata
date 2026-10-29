import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { stepInputPaths } from '../util/step-inputs';

const abs = (path: string): string => resolve(REPO_ROOT, path);

const inputs = new Set(await stepInputPaths('build:catalog'));

describe('stepInputPaths(build:catalog)', () => {
  it('keys the src/client and scripts/colour modules the build imports', () => {
    expect(inputs).toContain(abs('src/client/star-pipeline/extinction/dust-raymarch-pure.ts'));
    expect(inputs).toContain(abs('scripts/colour/blackbody-lut-pure.ts'));
  });

  it('keys the count snapshots the build asserts against', () => {
    expect(inputs).toContain(abs('scripts/catalog/build-catalog-expected.json'));
    expect(inputs).toContain(abs('scripts/catalog/distance/refinement/build-distance-outliers-expected.json'));
  });

  it('keys the naming tables, the dust chunks and the magnitude pull', () => {
    expect(inputs).toContain(abs('data/naming/name_overrides.tsv'));
    expect(inputs).toContain(abs('data/iau-wgsn/wgsn_names.tsv'));
    expect(inputs).toContain(abs('data/dust/chunk_0_0_0.bin'));
    expect(inputs).toContain(abs('data/gaia/gaia_dr3_magnitude_pull.tsv'));
  });

  it('keys a declared source\'s members and every frozen input the build reads', () => {
    expect(inputs).toContain(abs('data/tycho2/tycho2_suppl1.tsv'));
    expect(inputs).toContain(abs('data/classic-ids/cross_index_corrections.tsv'));
    expect(inputs).toContain(abs('data/stellarium/stellarium-modern-skyculture.json'));
    expect(inputs).toContain(abs('data/gcvs/crossid.txt'));
  });

  it('keys the SID bridges folder by its listing, never its README', () => {
    expect(inputs).not.toContain(abs('data/sid/bridges/README.md'));
    expect([...inputs].filter((p) => p.startsWith(abs('data/sid/bridges/')))
      .every((p) => p.endsWith('.tsv'))).toBe(true);
  });

  it('leaves out the outputs it writes and the files it never reads', () => {
    expect(inputs).not.toContain(abs('data/membership/parked-ledger.tsv'));
    expect(inputs).not.toContain(abs('data/athyg/simbad_sourced_distances.tsv'));
    expect(inputs).not.toContain(abs('data/gaia/gaia_dr3_tyc_xmatch.tsv'));
    expect(inputs).not.toContain(abs('data/sid/ledger-head.json'));
  });

  it('leaves out the build steps it does not run', () => {
    expect(inputs).not.toContain(abs('scripts/catalog/membership/build-membership-manifest.ts'));
    expect(inputs).not.toContain(abs('scripts/catalog/classic-ids/build-classic-id-overlay.ts'));
  });
});
