import { describe, expect, it } from 'vitest';

import type { EventRow } from './events-pure';
import { registryPaths } from './registry-outputs';
import { CATALOG_PARTITION, partitionOf, REGISTRY_PARTITIONS } from './registry-partitions-pure';
import { unionLedger, unionLedgerLines, validateRegistry, type PartitionRows } from './registry-pure';
import type { LedgerRow } from './sid-pure';

const row = (sid: number, canonicalKey: string, kind: LedgerRow['kind'] = 'star'): LedgerRow => (
  { sid, canonicalKey, kind, firstSeen: '2026-07-10' }
);
const retire = (sid: number): EventRow => (
  { sid, date: '2026-07-10', event: 'retire', code: 'c', params: '', successor: null, buildVersion: '7.1.6' }
);
const isCode = (code: string): boolean => code === 'c';

const parts = (): PartitionRows[] => [
  { partition: CATALOG_PARTITION, ledger: [row(1, 'hip:1'), row(3, 'sol:mars', 'planet')], events: [retire(1)] },
  { partition: 'cloud', ledger: [row(2, 'cloud:orion-a', 'cloud')], events: [] },
  { partition: 'lg', ledger: [row(4, 'lg:m31', 'galaxy')], events: [] },
];

describe('registry partitions', () => {
  it('give the catalogue every namespace but the siblings, each sibling its own', () => {
    expect(REGISTRY_PARTITIONS).toEqual([CATALOG_PARTITION, 'cloud', 'lg']);
    expect(['hip', 'gaia_dr3', 'synth', 'sol', 'shell'].map(partitionOf)).toEqual(Array(5).fill(CATALOG_PARTITION));
    expect(partitionOf('cloud')).toBe('cloud');
    expect(partitionOf('lg')).toBe('lg');
  });

  it('give each partition its own three files', () => {
    const paths = REGISTRY_PARTITIONS.flatMap((p) => Object.values(registryPaths(p)));
    expect(new Set(paths).size).toBe(REGISTRY_PARTITIONS.length * 3);
  });

  it('refuse, at compile time, a partition no step allocates', () => {
    // @ts-expect-error 'clouds' is the sibling's name, not its namespace
    expect(() => registryPaths('clouds')).not.toThrow();
  });
});

describe('unionLedger', () => {
  it('interleaves the partitions into one sid sequence', () => {
    expect(unionLedger(parts()).map((r) => r.sid)).toEqual([1, 2, 3, 4]);
  });

  it('orders data lines the same way, by leading sid, never lexically', () => {
    expect(unionLedgerLines([['1\ta', '10\tb'], ['2\tc']])).toEqual(['1\ta', '2\tc', '10\tb']);
  });
});

describe('validateRegistry', () => {
  it('passes partitions that together are one dense sequence', () => {
    expect(validateRegistry(parts(), isCode)).toEqual([]);
  });

  it('refuses a gap or a duplicate across partitions', () => {
    const gap = parts();
    gap[2] = { ...gap[2], ledger: [row(5, 'lg:m31', 'galaxy')] };
    expect(validateRegistry(gap, isCode).join('\n')).toMatch(/dense/);
    const dup = parts();
    dup[2] = { ...dup[2], ledger: [row(2, 'lg:m31', 'galaxy')] };
    expect(validateRegistry(dup, isCode).join('\n')).toMatch(/dense/);
  });

  it('refuses a row keyed in another partition\'s namespace, and a file out of sid order', () => {
    const foreign = parts();
    foreign[1] = { ...foreign[1], ledger: [row(2, 'hip:2')] };
    expect(validateRegistry(foreign, isCode)).toEqual(['cloud ledger: sid 2 keys "hip:2", another partition\'s namespace']);
    const unordered = parts();
    unordered[0] = { ...unordered[0], ledger: [row(3, 'sol:mars', 'planet'), row(1, 'hip:1')] };
    expect(validateRegistry(unordered, isCode)).toContain('catalog ledger: sid 1 follows 3');
  });

  it('refuses an event on a sid of another partition', () => {
    const crossed = parts();
    crossed[1] = { ...crossed[1], events: [retire(1)] };
    expect(validateRegistry(crossed, isCode)).toEqual(['cloud events: retire of sid 1: sid not in ledger']);
  });
});
