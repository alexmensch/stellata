import { describe, expect, it } from 'vitest';

import {
  nodeRecords, parseSystemMembership, serializeSystemMembership, SYSTEM_MEMBERSHIP_VERSION,
  type GroupNode, type SystemMembership,
} from './system-membership-format';

const rec = (record: number) => ({ kind: 'record', record }) as const;
const group = (component: string | null, ...children: GroupNode['children']): GroupNode => ({ kind: 'group', component, children });

const castor: SystemMembership = {
  systems: [
    {
      sources: ['wds', 'ccdm'],
      root: group(null, group('A', rec(3), rec(40)), group('B', rec(7), rec(41)), group('C', rec(90), rec(91)), rec(500)),
    },
    { sources: ['geometric'], root: group(null, rec(12), rec(13)) },
  ],
  companions: new Map([[3, ['eclipsing-partner', 'ccdm-companion'] as const], [12, ['simbad-multiple'] as const]]),
};

const wire = (o: unknown) => JSON.stringify(o);

describe('system-membership-format', () => {
  it('round-trips a nested tree, sources and companions', () => {
    const text = serializeSystemMembership(castor);
    expect(parseSystemMembership(text)).toEqual(castor);
    expect(serializeSystemMembership(parseSystemMembership(text))).toBe(text);
  });

  it('writes a record leaf as its bare index and a null component as an absent key', () => {
    const parsed = JSON.parse(serializeSystemMembership(castor)) as { systems: { root: unknown }[] };
    expect(parsed.systems[1].root).toEqual({ children: [12, 13] });
  });

  it('nodeRecords lists every leaf depth first', () => {
    expect(nodeRecords(castor.systems[0].root)).toEqual([3, 40, 7, 41, 90, 91, 500]);
  });

  const base = { version: SYSTEM_MEMBERSHIP_VERSION, companions: [] };
  it.each([
    ['a version mismatch', { ...base, version: 0, systems: [] }, /version 0/],
    ['an unknown source', { ...base, systems: [{ sources: ['simbad'], root: { children: [1, 2] } }] }, /unknown value "simbad"/],
    ['sources out of order', { ...base, systems: [{ sources: ['ccdm', 'wds'], root: { children: [1, 2] } }] }, /not unique and in order/],
    ['empty sources', { ...base, systems: [{ sources: [], root: { children: [1, 2] } }] }, /not a non-empty list/],
    ['a one-child group', { ...base, systems: [{ sources: ['wds'], root: { children: [1, { children: [2] }] } }] }, /fewer than two children/],
    ['a single-record root', { ...base, systems: [{ sources: ['wds'], root: 4 }] }, /root is a single record/],
    ['a record in two systems', { ...base, systems: [{ sources: ['wds'], root: { children: [1, 2] } }, { sources: ['ccdm'], root: { children: [2, 3] } }] }, /record 2 is in more than one place/],
    ['a negative record', { ...base, systems: [{ sources: ['wds'], root: { children: [1, -2] } }] }, /neither a record index nor a group/],
    ['an empty component', { ...base, systems: [{ sources: ['wds'], root: { component: '', children: [1, 2] } }] }, /not a token/],
    ['an unknown companion kind', { ...base, systems: [], companions: [[5, ['wings']]] }, /unknown value "wings"/],
    ['a record with two companion entries', { ...base, systems: [], companions: [[5, ['simbad-multiple']], [5, ['eclipsing-partner']]] }, /two companion entries/],
  ])('refuses %s', (_label, file, message) => {
    expect(() => parseSystemMembership(wire(file))).toThrow(message);
  });
});
