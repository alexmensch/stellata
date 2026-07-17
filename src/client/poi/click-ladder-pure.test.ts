import { describe, expect, it } from 'vitest';
import { clickLadderAction } from './click-ladder-pure';

const base = { pinnable: true, pinned: false, atCap: false, isVectorDest: false };

describe('clickLadderAction', () => {
  it('rung 1: an unpinned pinnable object pins', () => {
    expect(clickLadderAction({ ...base })).toBe('pin');
  });

  it('rung 2: a pinned object becomes the vector destination', () => {
    expect(clickLadderAction({ ...base, pinned: true })).toBe('vector');
  });

  it('rung 3: pinned + vector destination clears both', () => {
    expect(clickLadderAction({ ...base, pinned: true, isVectorDest: true })).toBe('clearBoth');
  });

  it('unpinnable (Sol) skips the pin rung: vector, then clear vector', () => {
    expect(clickLadderAction({ ...base, pinnable: false })).toBe('vector');
    expect(clickLadderAction({ ...base, pinnable: false, isVectorDest: true })).toBe('clearVector');
  });

  it('at cap, an unpinned object falls through to the vector rung', () => {
    expect(clickLadderAction({ ...base, atCap: true })).toBe('vector');
    expect(clickLadderAction({ ...base, atCap: true, isVectorDest: true })).toBe('clearVector');
  });

  it('at cap, an already-pinned object still cycles vector → clear both', () => {
    expect(clickLadderAction({ ...base, pinned: true, atCap: true })).toBe('vector');
    expect(clickLadderAction({ ...base, pinned: true, atCap: true, isVectorDest: true })).toBe('clearBoth');
  });

  it('a search-set vector destination that is not pinned pins on click', () => {
    expect(clickLadderAction({ ...base, isVectorDest: true })).toBe('pin');
  });
});
