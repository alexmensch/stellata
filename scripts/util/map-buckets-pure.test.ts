import { describe, expect, it } from 'vitest';

import { addTo, groupBy, pushTo } from './map-buckets-pure';

describe('map buckets', () => {
  it('groups in first-seen key order, items in input order', () => {
    const grouped = groupBy(['b1', 'a1', 'b2'], (s) => s[0]);
    expect([...grouped]).toEqual([['b', ['b1', 'b2']], ['a', ['a1']]]);
  });

  it('pushes into a list and adds into a set, creating each bucket on first use', () => {
    const lists = new Map<string, number[]>();
    pushTo(lists, 'k', 1);
    pushTo(lists, 'k', 1);
    const sets = new Map<string, Set<number>>();
    addTo(sets, 'k', 1);
    addTo(sets, 'k', 1);
    expect(lists.get('k')).toEqual([1, 1]);
    expect([...sets.get('k')!]).toEqual([1]);
  });
});
