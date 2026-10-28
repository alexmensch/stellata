import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { CATALOG_OUTPUTS } from './catalog-outputs';
import { PARKED_LEDGER } from './distance/parallax/parked-ledger-tsv';
import { SIMBAD_SOURCED_DISTANCES } from './distance/parallax/simbad-sourced-ledger-tsv';
import { catalogChunkFilename } from './record/catalog-pure';

const repoRelative = (p: string) => relative(REPO_ROOT, p);

describe('CATALOG_OUTPUTS', () => {
  it('declares the committed ledgers, so the catalogue stamp records them', () => {
    expect(Object.values(CATALOG_OUTPUTS.files).map(repoRelative)).toEqual(expect.arrayContaining([
      PARKED_LEDGER.file,
      SIMBAD_SOURCED_DISTANCES.file,
    ]));
  });

  it('declares the transport chunks as one family in public/', () => {
    expect(CATALOG_OUTPUTS.families).toHaveLength(1);
    const [chunks] = CATALOG_OUTPUTS.families;
    expect(repoRelative(chunks.dir)).toBe('public');
    expect(chunks.member.test(catalogChunkFilename(12))).toBe(true);
    expect(chunks.member.test('catalog-manifest.json')).toBe(false);
  });
});
