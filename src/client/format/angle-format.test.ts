import { describe, expect, it } from 'vitest';
import { fmtLonDeg } from './angle-format';

describe('fmtLonDeg', () => {
  it('wraps longitude into [0, 360)', () => {
    expect(fmtLonDeg(0)).toBe('0°');
    expect(fmtLonDeg(350)).toBe('350°');
    expect(fmtLonDeg(360)).toBe('0°');
    expect(fmtLonDeg(-10)).toBe('350°');
    expect(fmtLonDeg(-0.4)).toBe('0°');
  });
});
