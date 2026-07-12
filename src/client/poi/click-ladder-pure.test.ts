import { describe, expect, it } from 'vitest';
import { starLadderAction } from './click-ladder-pure';

const base = { pinnable: true, pinned: false, atCap: false, isVectorDest: false };

describe('starLadderAction', () => {
  it('rung 1: an unpinned pinnable star pins', () => {
    expect(starLadderAction({ ...base })).toBe('pin');
  });

  it('rung 2: a pinned star becomes the vector destination', () => {
    expect(starLadderAction({ ...base, pinned: true })).toBe('vector');
  });

  it('rung 3: pinned + vector destination clears both', () => {
    expect(starLadderAction({ ...base, pinned: true, isVectorDest: true })).toBe('clearBoth');
  });

  it('unpinnable (Sol) skips the pin rung: vector, then clear vector', () => {
    expect(starLadderAction({ ...base, pinnable: false })).toBe('vector');
    expect(starLadderAction({ ...base, pinnable: false, isVectorDest: true })).toBe('clearVector');
  });

  it('at cap, an unpinned star falls through to the vector rung', () => {
    expect(starLadderAction({ ...base, atCap: true })).toBe('vector');
    expect(starLadderAction({ ...base, atCap: true, isVectorDest: true })).toBe('clearVector');
  });

  it('at cap, an already-pinned star still cycles vector → clear both', () => {
    expect(starLadderAction({ ...base, pinned: true, atCap: true })).toBe('vector');
    expect(starLadderAction({ ...base, pinned: true, atCap: true, isVectorDest: true })).toBe('clearBoth');
  });

  it('a search-set vector destination that is not pinned pins on click', () => {
    expect(starLadderAction({ ...base, isVectorDest: true })).toBe('pin');
  });
});
