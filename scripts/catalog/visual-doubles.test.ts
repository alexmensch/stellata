import { describe, it, expect } from 'vitest';

import { collectPhysicalPairKeys } from './visual-doubles';
import { multiplesRow } from './companion-promotion.test';

describe('visual-doubles / collectPhysicalPairKeys', () => {
  it('returns empty sets for null rows', () => {
    const keys = collectPhysicalPairKeys(null);
    expect(keys.hips.size).toBe(0);
    expect(keys.gaia.size).toBe(0);
  });

  it('collects HIP and Gaia keys from non-standalone rows', () => {
    const keys = collectPhysicalPairKeys([
      multiplesRow({ orbitRole: 'primary', hip: 100, gaiaSourceId: 'g1' }),
      multiplesRow({ orbitRole: 'secondary', hip: 200, gaiaSourceId: 'g2' }),
    ]);
    expect([...keys.hips].sort()).toEqual([100, 200]);
    expect([...keys.gaia].sort()).toEqual(['g1', 'g2']);
  });

  it('skips standalone rows — single stars carry no boundness evidence', () => {
    const keys = collectPhysicalPairKeys([
      multiplesRow({ orbitRole: 'standalone', hip: 100, gaiaSourceId: 'g1' }),
    ]);
    expect(keys.hips.size).toBe(0);
    expect(keys.gaia.size).toBe(0);
  });

  it('omits null identifiers', () => {
    const keys = collectPhysicalPairKeys([
      multiplesRow({ orbitRole: 'primary', hip: null, gaiaSourceId: 'g1' }),
      multiplesRow({ orbitRole: 'secondary', hip: 200, gaiaSourceId: null }),
    ]);
    expect([...keys.hips]).toEqual([200]);
    expect([...keys.gaia]).toEqual(['g1']);
  });
});
