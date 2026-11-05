import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { declareOutputs } from '../util/emit-artifacts';

import { artifactText, isReadable, readArtifact } from '../util/sources/source';
import { retiredSids } from './events-pure';
import { EVENTS } from './events-tsv';
import { LEDGERS } from './ledger-tsv';
import { LOCAL_GROUP_JSON } from '../local-group/local-group-json';
import { allocateSibling, emitSibling } from './sibling-allocation';
import { SIBLING_ARTIFACTS } from './sibling-artifacts-pure';
import { CATALOG_PARTITION, registryKeys } from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  LOCAL_GROUP_ALLOCATION_LINEAGE, lineageLayout, stageOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

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
    const allocation = allocateSibling(spec, LOCAL_GROUP_JSON, committed);
    expect(allocation.sids).toEqual(liveRows.map((r) => r.sid));
    expect(allocation.minted).toBe(0);
    expect(allocation.registry).toBeNull();
  });

  it('writes one resolved row and one identity row per object, keyed on its record', () => {
    const allocation = allocateSibling(spec, LOCAL_GROUP_JSON, committed);
    const [first] = committed;
    expect(allocation.lines).toHaveLength(committed.length);
    expect(allocation.lines).toContain(`allocation-local-group\tlocal-group:${first.id}\toutcome\tallocation-local-group.resolved\t\t`);
    expect(allocation.identity).toContainEqual({
      key: `local-group:${first.id}`, tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '', designations: [`lg:${first.id}`],
    });
  });

  it('mints a new slug past the union and returns all three partition files', () => {
    const allocation = allocateSibling(spec, LOCAL_GROUP_JSON, [...committed, { id: 'probe-new-slug' }]);
    expect(allocation.minted).toBe(1);
    expect(allocation.lines).toContain(
      'allocation-local-group\tlocal-group:probe-new-slug\toutcome\tallocation-local-group.minted\t'
        + '{"canonical_key":"lg:probe-new-slug","route":"allocation.mint.local-group"}\t',
    );
    expect(Object.keys(allocation.registry!).sort()).toEqual([keys.events, keys.head, keys.ledger].sort());
    expect(allocation.registry![keys.ledger].startsWith(artifactText(LEDGERS.lg))).toBe(true);
    expect(allocation.registry![keys.ledger]).toContain('\tlg:probe-new-slug\tgalaxy\t');
  });

  it('refuses, at typecheck, an artifact whose rows another sibling cites', () => {
    const mismatched = () => allocateSibling(
      SIBLING_ARTIFACTS.clouds,
      // @ts-expect-error: local-group.json's rows are not clouds:<slug>
      LOCAL_GROUP_JSON,
      [],
    );
    expect(typeof mismatched).toBe('function');
  });

  it('fails closed on a vanished slug, naming the bridge remedy', () => {
    expect(() => allocateSibling(spec, LOCAL_GROUP_JSON, committed.slice(1))).toThrow(/lg SID allocation failed[\s\S]*sameas-overrides/);
  });
});

describe('emitSibling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emit-sibling-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const lineageFiles = stageOutputFiles(lineageLayout(dir), LOCAL_GROUP_ALLOCATION_LINEAGE);
  const outputs = declareOutputs({
    localGroup: join(dir, 'local-group.json'),
    [keys.ledger]: join(dir, 'ledger-lg.tsv'),
    [keys.events]: join(dir, 'events-lg.tsv'),
    [keys.head]: join(dir, 'ledger-head-lg.json'),
    ...lineageFiles,
  });
  const lineage = {
    files: Object.fromEntries(Object.keys(lineageFiles).map((k) => [k, 'z'])) as Record<keyof typeof lineageFiles, string>,
    members: new Map(),
    checks: [],
  };
  const landed = (): string[] => readdirSync(dir).sort();
  const none = { lines: [], identity: [] };

  it('lands only the artifact and its lineage when the allocation appended nothing', () => {
    emitSibling(outputs, { localGroup: 'x' }, { sids: [], minted: 0, registry: null, ...none }, lineage);
    expect(landed()).toEqual(['lineage', 'local-group.json']);
    expect(readdirSync(join(dir, 'lineage')).sort()).toEqual([
      'allocation-local-group.header.json', 'allocation-local-group.identity.tsv.gz', 'allocation-local-group.tsv.gz',
    ]);
  });

  it('lands the artifact, its lineage and all three partition files when it appended', () => {
    const registry = { [keys.ledger]: 'l', [keys.events]: 'e', [keys.head]: 'h' };
    emitSibling(outputs, { localGroup: 'y' }, { sids: [], minted: 1, registry, ...none }, lineage);
    expect(landed()).toEqual(['events-lg.tsv', 'ledger-head-lg.json', 'ledger-lg.tsv', 'lineage', 'local-group.json']);
    expect(readFileSync(join(dir, 'ledger-lg.tsv'), 'utf8')).toBe('l');
  });
});
