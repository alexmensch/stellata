import { describe, expect, it } from 'vitest';

import { stage4Rates, type Stage4Counts } from './attach-orbits';

const counts = (over: Partial<Stage4Counts>): Stage4Counts => ({
  orbit_orb6: 0, orbit_gaia_nss: 0, orbit_orb6_spectroscopic: 0, orbit_msc: 0, orbit_none: 0, ...over,
});

describe('stage4Rates', () => {
  it('rates NSS over the pairs with elements, never over none', () => {
    expect(stage4Rates(counts({ orbit_orb6: 3, orbit_gaia_nss: 1, orbit_none: 100 })).nss_orbit_rate).toBe(0.25);
  });

  it('throws when no pair has elements', () => {
    expect(() => stage4Rates(counts({ orbit_none: 5 }))).toThrow(/nss_orbit_rate/);
  });
});
