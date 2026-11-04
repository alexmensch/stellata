import { describe, expect, it } from 'vitest';
import { RELIEF_BODIES, reliefBodyOf } from './baker-constants';

describe('reliefBodyOf', () => {
  it('answers a relief body by its texture key', () => {
    expect(reliefBodyOf('moon')).toBe(RELIEF_BODIES.moon);
  });

  it('answers null for a body with no relief and for an inherited property name', () => {
    expect(reliefBodyOf('jupiter')).toBeNull();
    expect(reliefBodyOf('toString')).toBeNull();
  });
});
