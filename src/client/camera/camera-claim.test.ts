import { describe, it, expect } from 'vitest';
import { createCameraClaim } from './camera-claim';

function makeClaim(busy: { warp?: boolean; aim?: boolean; observe?: boolean } = {}) {
  const cancelled: string[] = [];
  const claim = createCameraClaim({
    isWarpActive: () => busy.warp === true,
    isAimActive: () => busy.aim === true,
    isObserveTransitionActive: () => busy.observe === true,
    cancelUnfocusLerp: () => { cancelled.push('unfocus'); },
    cancelFocusLerp: () => { cancelled.push('focus'); },
  });
  return { claim, cancelled };
}

describe('createCameraClaim', () => {
  it('grants a free camera and cancels both focus lerps', () => {
    const { claim, cancelled } = makeClaim();
    expect(claim.isHeld()).toBe(false);
    expect(claim.claim()).toBe(true);
    expect(cancelled).toEqual(['unfocus', 'focus']);
  });

  it.each(['warp', 'aim', 'observe'] as const)('refuses during %s and leaves both lerps running', (owner) => {
    const { claim, cancelled } = makeClaim({ [owner]: true });
    expect(claim.isHeld()).toBe(true);
    expect(claim.claim()).toBe(false);
    expect(cancelled).toEqual([]);
  });
});
