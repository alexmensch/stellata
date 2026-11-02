import { describe, expect, it } from 'vitest';

import { artifactText, isReadable, readArtifact } from '../util/sources/source';
import { LEDGERS } from './ledger-tsv';
import { CATALOG_PARTITION, registryKeys } from './registry-partitions-pure';
import { allocateSibling, siblingEmission } from './sibling-allocation';
import { SIBLING_ARTIFACTS } from './sibling-artifacts';

const spec = SIBLING_ARTIFACTS['local-group'];
const keys = registryKeys(spec.ns);
const committed = isReadable(LEDGERS[CATALOG_PARTITION])
  ? readArtifact(LEDGERS.lg).map((r) => ({ id: r.canonicalKey.slice(`${spec.ns}:`.length) }))
  : [];

describe.skipIf(committed.length === 0)('allocateSibling over the committed registry', () => {
  it('resolves every committed slug to its SID and rewrites no registry file', () => {
    const allocation = allocateSibling(spec, committed);
    expect(allocation.sids).toEqual(readArtifact(LEDGERS.lg).map((r) => r.sid));
    expect(allocation.minted).toBe(0);
    expect(allocation.registry).toEqual({});
  });

  it('mints a new slug past the union and returns all three partition files', () => {
    const allocation = allocateSibling(spec, [...committed, { id: 'probe-new-slug' }]);
    expect(allocation.minted).toBe(1);
    expect(Object.keys(allocation.registry).sort()).toEqual([keys.events, keys.head, keys.ledger].sort());
    expect(allocation.registry[keys.ledger]!.startsWith(artifactText(LEDGERS.lg))).toBe(true);
    expect(allocation.registry[keys.ledger]).toContain('\tlg:probe-new-slug\tgalaxy\t');
  });

  it('fails closed on a vanished slug, naming the bridge remedy', () => {
    expect(() => allocateSibling(spec, committed.slice(1))).toThrow(/lg SID allocation failed[\s\S]*sameas-overrides/);
  });
});

describe('siblingEmission', () => {
  it('emits only the artifact when the allocation appended nothing', () => {
    const emission = siblingEmission({ localGroup: 'x' }, { sids: [], minted: 0, registry: {} });
    expect(emission).toEqual({ only: ['localGroup'], files: { localGroup: 'x' } });
  });

  it('emits the artifact and every registry file the allocation produced', () => {
    const registry = { [keys.ledger]: 'l', [keys.events]: 'e', [keys.head]: 'h' };
    const emission = siblingEmission({ localGroup: 'x' }, { sids: [], minted: 1, registry });
    expect(emission.only.sort()).toEqual(['localGroup', keys.events, keys.head, keys.ledger].sort());
    expect(emission.files).toEqual({ localGroup: 'x', ...registry });
  });
});
