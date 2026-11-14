import { describe, expect, it } from 'vitest';

import { companionAbsmagIsObserved, companionCiIsObservedVia } from './companion-dust-pure';

describe('which companion values embed the A_V', () => {
  it('every absmag source but class→M_V is observed', () => {
    expect((['dmag_imputed', 'own', 'wds_mag', 'spectral', 'inherited_twin', 'anchor_collocated'] as const)
      .filter(companionAbsmagIsObserved)).toEqual(['dmag_imputed', 'own', 'wds_mag', 'inherited_twin', 'anchor_collocated']);
  });

  it('only the row\'s own B−V is observed', () => {
    expect((['own', 'spectral_derived', 'none'] as const).filter(companionCiIsObservedVia)).toEqual(['own']);
  });
});
