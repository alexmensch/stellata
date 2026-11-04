import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { declareOutputs } from '../util/emit-artifacts';

import { artifactText, isReadable, readArtifact } from '../util/sources/source';
import { retiredSids } from './events-pure';
import { EVENTS } from './events-tsv';
import { LEDGERS } from './ledger-tsv';
import { allocateSibling, emitSibling } from './sibling-allocation';
import { SIBLING_ARTIFACTS } from './sibling-artifacts-pure';
import { CATALOG_PARTITION, registryKeys } from '../../src/catalog-format/pipeline-outputs/data-files';

const spec = SIBLING_ARTIFACTS['local-group'];
const keys = registryKeys(spec.ns);
const liveRows = isReadable(LEDGERS[CATALOG_PARTITION])
  ? (() => {
    const retired = retiredSids(readArtifact(EVENTS.lg));
    return readArtifact(LEDGERS.lg).filter((r) => !retired.has(r.sid));
  })()
  : [];
const committed = liveRows.map((r) => ({ id: r.canonicalKey.slice(`${spec.ns}:`.length) }));

describe.skipIf(committed.length === 0)('allocateSibling over the committed registry', () => {
  it('resolves every committed slug to its SID and rewrites no registry file', () => {
    const allocation = allocateSibling(spec, committed);
    expect(allocation.sids).toEqual(liveRows.map((r) => r.sid));
    expect(allocation.minted).toBe(0);
    expect(allocation.registry).toBeNull();
  });

  it('mints a new slug past the union and returns all three partition files', () => {
    const allocation = allocateSibling(spec, [...committed, { id: 'probe-new-slug' }]);
    expect(allocation.minted).toBe(1);
    expect(Object.keys(allocation.registry!).sort()).toEqual([keys.events, keys.head, keys.ledger].sort());
    expect(allocation.registry![keys.ledger].startsWith(artifactText(LEDGERS.lg))).toBe(true);
    expect(allocation.registry![keys.ledger]).toContain('\tlg:probe-new-slug\tgalaxy\t');
  });

  it('fails closed on a vanished slug, naming the bridge remedy', () => {
    expect(() => allocateSibling(spec, committed.slice(1))).toThrow(/lg SID allocation failed[\s\S]*sameas-overrides/);
  });
});

describe('emitSibling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emit-sibling-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const outputs = declareOutputs({
    localGroup: join(dir, 'local-group.json'),
    [keys.ledger]: join(dir, 'ledger-lg.tsv'),
    [keys.events]: join(dir, 'events-lg.tsv'),
    [keys.head]: join(dir, 'ledger-head-lg.json'),
  });
  const landed = (): string[] => readdirSync(dir).sort();

  it('lands only the artifact when the allocation appended nothing', () => {
    emitSibling(outputs, { localGroup: 'x' }, { sids: [], minted: 0, registry: null });
    expect(landed()).toEqual(['local-group.json']);
  });

  it('lands the artifact and all three partition files when it appended', () => {
    const registry = { [keys.ledger]: 'l', [keys.events]: 'e', [keys.head]: 'h' };
    emitSibling(outputs, { localGroup: 'y' }, { sids: [], minted: 1, registry });
    expect(landed()).toEqual(['events-lg.tsv', 'ledger-head-lg.json', 'ledger-lg.tsv', 'local-group.json']);
    expect(readFileSync(join(dir, 'ledger-lg.tsv'), 'utf8')).toBe('l');
  });
});
