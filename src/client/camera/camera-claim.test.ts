import { describe, it, expect } from 'vitest';
import { claimCamera, isCameraHeld, type CameraClaimGates } from './camera-claim';

function makeGates(busy: { warp?: boolean; aim?: boolean; observe?: boolean } = {}) {
  const cancelled: string[] = [];
  const gates: CameraClaimGates = {
    isWarpActive: () => busy.warp === true,
    isAimActive: () => busy.aim === true,
    isObserveTransitionActive: () => busy.observe === true,
    cancelUnfocusLerp: () => { cancelled.push('unfocus'); },
    cancelFocusLerp: () => { cancelled.push('focus'); },
  };
  return { gates, cancelled };
}

describe('claimCamera', () => {
  it('grants a free camera and cancels both focus lerps', () => {
    const { gates, cancelled } = makeGates();
    expect(isCameraHeld(gates)).toBe(false);
    expect(claimCamera(gates)).toBe(true);
    expect(cancelled).toEqual(['unfocus', 'focus']);
  });

  it.each(['warp', 'aim', 'observe'] as const)('refuses during %s and leaves both lerps running', (owner) => {
    const { gates, cancelled } = makeGates({ [owner]: true });
    expect(isCameraHeld(gates)).toBe(true);
    expect(claimCamera(gates)).toBe(false);
    expect(cancelled).toEqual([]);
  });
});
