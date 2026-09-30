import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { catalogInputPaths } from './catalog-inputs';

const abs = (path: string): string => resolve(REPO_ROOT, path);

const inputs = new Set(await catalogInputPaths());

describe('catalogInputPaths', () => {
  it('keys the src/client and scripts/colour modules the build imports', () => {
    expect(inputs).toContain(abs('src/client/star-pipeline/extinction/dust-raymarch-pure.ts'));
    expect(inputs).toContain(abs('scripts/colour/blackbody-lut-pure.ts'));
  });

  it('keys the count snapshots the build asserts against', () => {
    expect(inputs).toContain(abs('scripts/catalog/build-catalog-expected.json'));
    expect(inputs).toContain(abs('scripts/catalog/distance/build-distance-outliers-expected.json'));
  });

  it('keys the naming tables, the dust chunks and the magnitude pull', () => {
    expect(inputs).toContain(abs('data/naming/name_overrides.tsv'));
    expect(inputs).toContain(abs('data/iau-wgsn/wgsn_names.tsv'));
    expect(inputs).toContain(abs('data/dust/chunk_0_0_0.bin'));
    expect(inputs).toContain(abs('data/gaia/gaia_dr3_magnitude_pull.tsv'));
  });

  it('leaves out the build steps it does not run', () => {
    expect(inputs).not.toContain(abs('scripts/catalog/membership/build-membership-manifest.ts'));
    expect(inputs).not.toContain(abs('scripts/catalog/classic-ids/build-classic-id-overlay.ts'));
  });
});
