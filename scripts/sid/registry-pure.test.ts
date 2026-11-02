import { describe, expect, it } from 'vitest';

import type { EventRow } from './events-pure';
import { registryPaths } from './registry-outputs';
import {
  CATALOG_PARTITION, partitionOf, REGISTRY_PARTITIONS, registryHint, type RegistryPartition,
} from './registry-partitions-pure';
import { SIBLING_ARTIFACTS } from './sibling-artifacts';
import {
  registryAppendOnly, unionLedger, unionLedgerLines, validateRegistry, type PartitionLines, type PartitionRows,
} from './registry-pure';
import { computeLedgerHead, LEDGER_HEADER, type LedgerHead, type LedgerRow } from './sid-pure';
import { EVENT_COLUMNS } from './events-pure';

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

  it('name the command that grows each partition, a sibling\'s from its own build hint', () => {
    expect(registryHint(CATALOG_PARTITION)).toContain('pnpm run build:catalog');
    expect(registryHint('lg')).toContain(SIBLING_ARTIFACTS['local-group'].buildHint);
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

  it('refuses a merge whose successor sits in another partition', () => {
    const merged = parts();
    merged[0] = { ...merged[0], events: [{ ...retire(1), event: 'merge', successor: 2 }] };
    expect(validateRegistry(merged, isCode)).toEqual(['catalog events: merge of sid 1: successor 2 not in ledger']);
  });
});

describe('registryAppendOnly', () => {
  const text = (header: string, lines: readonly string[]): string => [header, ...lines, ''].join('\n');
  const head = (ledger: readonly string[], events: readonly string[] = []): LedgerHead => computeLedgerHead(
    text(LEDGER_HEADER, ledger), text(EVENT_COLUMNS.join('\t'), events),
  );
  const line = (sid: number, key: string, kind = 'star'): string => `${sid}\t${key}\t${kind}\t2026-07-10`;
  const catalog = [line(1, 'hip:1'), line(3, 'hip:3')];
  const cloud = [line(2, 'cloud:orion-a', 'cloud')];
  const split = (c = catalog, cl = cloud, lg: string[] = []): PartitionLines[] => [
    { partition: CATALOG_PARTITION, ledger: c, events: [] },
    { partition: 'cloud', ledger: cl, events: [] },
    { partition: 'lg', ledger: lg, events: [] },
  ];
  const bases = (entries: [RegistryPartition, LedgerHead][]) => new Map<RegistryPartition, LedgerHead>(entries);
  const preSplit = bases([[CATALOG_PARTITION, head([line(1, 'hip:1'), ...cloud, line(3, 'hip:3')])]]);
  const postSplit = bases([[CATALOG_PARTITION, head(catalog)], ['cloud', head(cloud)], ['lg', head([])]]);

  it('is unchecked with no catalogue base head', () => {
    expect(registryAppendOnly(bases([]), split())).toEqual({ kind: 'unchecked' });
  });

  it('against a pre-split base, accepts the rows moved byte-identical and refuses a moved row edited', () => {
    expect(registryAppendOnly(preSplit, split())).toEqual({ kind: 'checked', errors: [] });
    const edited = registryAppendOnly(preSplit, split(catalog, [line(2, 'cloud:orion-b', 'cloud')]));
    expect(edited.kind === 'checked' ? edited.errors : []).toEqual([expect.stringMatching(/^ledger union: frozen prefix/)]);
  });

  it('against a post-split base, refuses a row moved between partitions', () => {
    const moved = registryAppendOnly(postSplit, split([...catalog, cloud[0]], []));
    expect(moved.kind === 'checked' ? moved.errors : []).toContainEqual(expect.stringMatching(/^cloud ledger: 0 rows < frozen base 1/));
  });

  it('freezes nothing in a partition the base has no head for, once the base is split', () => {
    const noLg = bases([[CATALOG_PARTITION, head(catalog)], ['cloud', head(cloud)]]);
    expect(registryAppendOnly(noLg, split(catalog, cloud, [line(4, 'lg:m31', 'galaxy')]))).toEqual({ kind: 'checked', errors: [] });
  });
});
