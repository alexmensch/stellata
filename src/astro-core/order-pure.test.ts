import { describe, expect, it } from 'vitest';

import { ascending, compareCodeUnits } from './order-pure';

describe('ascending', () => {
  it('orders numbers and bigints by value, strings by code unit', () => {
    expect([10, 9, -1].sort(ascending)).toEqual([-1, 9, 10]);
    expect([2n ** 60n + 1n, 2n ** 60n, 3n].sort(ascending)).toEqual([3n, 2n ** 60n, 2n ** 60n + 1n]);
    expect(['b', 'B', 'a'].sort(compareCodeUnits)).toEqual(['B', 'a', 'b']);
    expect(ascending(7, 7)).toBe(0);
  });

  it('refuses at compile time to order strings against numbers', () => {
    const mixed: (string | number)[] = ['10', 9];
    // @ts-expect-error a string never orders against a number
    mixed.sort(ascending);
  });
});
