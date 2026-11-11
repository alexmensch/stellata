import { describe, expect, it } from 'vitest';

import { wdsDmag } from './pair-photometry-pure';

describe('wdsDmag', () => {
  it('is the secondary minus the primary (Sirius: +7.03)', () => {
    expect(wdsDmag(1.46, 8.49)).toBeCloseTo(7.03, 4);
  });

  it('is null when either magnitude is missing', () => {
    expect(wdsDmag(null, 8.49)).toBeNull();
    expect(wdsDmag(1.46, null)).toBeNull();
  });
});
