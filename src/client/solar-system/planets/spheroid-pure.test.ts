import { describe, expect, it } from 'vitest';
import { SOL_PLANETS } from '../planet-system';
import { polarRadiusRatio } from './spheroid-pure';

describe('polarRadiusRatio', () => {
  it('is 1 for a body with no published flattening', () => {
    expect(polarRadiusRatio({})).toBe(1);
    expect(polarRadiusRatio({ flattening: undefined })).toBe(1);
  });

  it('carries the atmospheric bodies’ published flattening', () => {
    const of = (name: string) =>
      polarRadiusRatio(SOL_PLANETS.find((p) => p.name === name)!);
    expect(of('Earth')).toBeCloseTo(0.99665, 12);
    expect(of('Mars')).toBeCloseTo(0.99411, 12);
    // Venus and Titan are spherical, which is why the seam this ratio fixes
    // showed on exactly the other two atmospheric bodies.
    expect(of('Venus')).toBe(1);
  });

  it('is a large fraction of the shell, which is why f cannot be dropped', () => {
    // The approximation this replaces was "f is ≤ 0.6 % of the radius, so
    // ignore it". Against the SHELL, which is what the march resolves, it is
    // 21 % on Earth and 33 % on Mars.
    for (const [name, minShare] of [
      ['Earth', 0.2],
      ['Mars', 0.3],
    ] as const) {
      const body = SOL_PLANETS.find((p) => p.name === name)!;
      const shellR = body.atmosphere!.heightKm / body.radiusKm;
      expect((1 - polarRadiusRatio(body)) / shellR).toBeGreaterThan(minShare);
    }
  });
});
