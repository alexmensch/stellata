import { describe, it, expect } from 'vitest';
import { shouldAdviseMobile, MOBILE_ADVISORY_MAX_WIDTH } from './mobile-advisory-pure';

const touchPhone = {
  width: 390,
  coarsePointer: true,
  hasTouch: true,
  signalsAvailable: true,
};

describe('shouldAdviseMobile', () => {
  it('advises on a narrow touch-only viewport', () => {
    expect(shouldAdviseMobile(touchPhone)).toBe(true);
  });

  it('does not advise on a wide viewport regardless of touch', () => {
    expect(shouldAdviseMobile({ ...touchPhone, width: 1440 })).toBe(false);
  });

  it('lets a narrow viewport with a fine pointer through (iPad + keyboard)', () => {
    expect(shouldAdviseMobile({ ...touchPhone, coarsePointer: false })).toBe(false);
  });

  it('lets a coarse pointer with no touch points through', () => {
    expect(shouldAdviseMobile({ ...touchPhone, hasTouch: false })).toBe(false);
  });

  it('falls back to viewport width alone when signals are unavailable', () => {
    expect(shouldAdviseMobile({
      width: 390, coarsePointer: false, hasTouch: false, signalsAvailable: false,
    })).toBe(true);
    expect(shouldAdviseMobile({
      width: 1440, coarsePointer: false, hasTouch: false, signalsAvailable: false,
    })).toBe(false);
  });

  it('treats the threshold as exclusive', () => {
    expect(shouldAdviseMobile({ ...touchPhone, width: MOBILE_ADVISORY_MAX_WIDTH })).toBe(false);
    expect(shouldAdviseMobile({ ...touchPhone, width: MOBILE_ADVISORY_MAX_WIDTH - 1 })).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(shouldAdviseMobile({ ...touchPhone, width: 500, threshold: 480 })).toBe(false);
  });
});
