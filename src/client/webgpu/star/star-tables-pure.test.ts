import { describe, expect, it } from 'vitest';
import { STAR_STATIC_FIELDS } from '../star-attribute-roster';
import {
  STAR_STATIC_STRIDE, buildStaticTable, staticElement, staticSlot, type StaticFieldSources,
} from './star-tables-pure';

function sources(count: number, fill = 0): StaticFieldSources {
  return Object.fromEntries(
    STAR_STATIC_FIELDS.map((f) => [f, new Float32Array(count).fill(fill)]),
  ) as unknown as StaticFieldSources;
}

describe('static star table layout', () => {
  it('holds 11 fields in a 12-float record — whole vec4s', () => {
    expect(STAR_STATIC_FIELDS).toHaveLength(11);
    expect(STAR_STATIC_STRIDE).toBe(12);
    expect(STAR_STATIC_STRIDE % 4).toBe(0);
  });

  it('slots follow roster order and the element index follows the stride', () => {
    expect(staticSlot('iAbsmag')).toBe(0);
    expect(staticSlot('iPulsColorSwing')).toBe(10);
    expect(staticElement(3, 'iDistSol')).toBe(3 * 12 + 7);
  });

  it('interleaves each field into its slot and leaves the pad at zero', () => {
    const s = sources(4);
    (s.iAbsmag as Float32Array)[2] = 5.5;
    (s.iPulsRho as Float32Array)[1] = 1.5;
    const table = buildStaticTable(s, 4);
    expect(table).toHaveLength(48);
    expect(table[staticElement(2, 'iAbsmag')]).toBe(5.5);
    expect(table[staticElement(1, 'iPulsRho')]).toBe(1.5);
    expect(table[1 * STAR_STATIC_STRIDE + 11]).toBe(0);
  });

  it('refuses a source whose length is not the star count', () => {
    const s = sources(4);
    (s as Record<string, ArrayLike<number>>).iCi = new Float32Array(3);
    expect(() => buildStaticTable(s, 4)).toThrow(/iCi/);
  });
});
