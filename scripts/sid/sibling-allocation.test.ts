import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

import { declareOutputs } from '../util/emit-artifacts';

import { artifactText, isReadable, readArtifact } from '../util/sources/source';
import { retiredSids } from './events-pure';
import { EVENTS } from './events-tsv';
import { LEDGERS } from './ledger-tsv';
import { SEEDED_BRANCH, seededCodeCheck } from '../catalog/lineage/count-block-fixture';
import { identityRows } from '../catalog/lineage/identity-pure';
import { lineageRows, stageLineageLine } from '../catalog/lineage/lineage-row-pure';
import { LOCAL_GROUP_JSON } from '../local-group/local-group-json';
import { allocateSibling, emitSibling, siblingLineage } from './sibling-allocation';
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

describe('siblingLineage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-lineage-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const stage = LOCAL_GROUP_ALLOCATION_LINEAGE.stage;
  const lines = [stageLineageLine(spec.codes, {
    stage, key: 'local-group:a', role: 'outcome', code: spec.codes.code('resolved'), params: '', evidence: [],
  })];
  const identity = [{ key: 'local-group:a', tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '', designations: ['lg:a'] }];

  const snapshot = join(dir, 'expected.json');
  const pinned = { ...spec, countsSnapshot: snapshot };
  writeFileSync(snapshot, JSON.stringify({
    stages: { [stage]: { [`${stage}.resolved`]: 1, [`${stage}.minted`]: 0, [`${stage}.reinstated`]: 0 } },
  }));

  it('renders the stage file and its identity file, each decoding back to what the allocation held', () => {
    const { files, checks, counts } = siblingLineage(pinned, { lines, identity }, lineageLayout(dir), {});
    const text = (key: keyof typeof files): string => gunzipSync(files[key] as Uint8Array).toString('utf8');
    expect([...lineageRows(text(`lineage:${stage}`), 'fixture')].map((r) => r.code)).toEqual([`${stage}.resolved`]);
    expect([...identityRows(text(`lineage:${stage}.identity`), 'fixture')]).toEqual(identity);
    expect(checks.map((c) => c.kind)).toEqual(['pass', 'pass']);
    expect(counts).toEqual({ [`${stage}.resolved`]: 1, [`${stage}.minted`]: 0, [`${stage}.reinstated`]: 0 });
  });

  it('checks its count block against the build\'s snapshot, failing on drift and naming the refresh', () => {
    const minted = [...lines, stageLineageLine(spec.codes, {
      stage, key: 'local-group:b', role: 'outcome', code: spec.codes.code('minted'), params: '', evidence: [],
    })];
    const [, counts] = siblingLineage(pinned, { lines: minted, identity }, lineageLayout(dir), {}).checks;
    expect(counts.kind).toBe('fail');
    expect(counts.kind === 'fail' && counts.report).toContain(`${stage}.minted`);
    expect(counts.kind === 'fail' && counts.message).toContain('build:local-group');
  });

  it('fails its snapshot check on a new code until the snapshot is refreshed, for each sibling', () => {
    for (const sibling of Object.values(SIBLING_ARTIFACTS)) {
      const row = stageLineageLine(sibling.codes, {
        stage: sibling.lineage.stage, key: 'x:a', role: 'outcome', code: sibling.codes.code('resolved'), params: '', evidence: [],
      });
      const { drift, refreshed } = seededCodeCheck(sibling.codes, [row]);
      expect(drift.drifted).toBe(true);
      expect(drift.report).toContain(`${sibling.lineage.stage}.${SEEDED_BRANCH}`);
      expect(refreshed.drifted).toBe(false);
    }
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
    emitSibling(outputs, { localGroup: 'x' }, { sids: [], registry: null, ...none }, lineage);
    expect(landed()).toEqual(['lineage', 'local-group.json']);
    expect(readdirSync(join(dir, 'lineage')).sort()).toEqual([
      'allocation-local-group.header.json', 'allocation-local-group.identity.tsv.gz', 'allocation-local-group.tsv.gz',
    ]);
  });

  it('lands the artifact, its lineage and all three partition files when it appended', () => {
    const registry = { [keys.ledger]: 'l', [keys.events]: 'e', [keys.head]: 'h' };
    emitSibling(outputs, { localGroup: 'y' }, { sids: [], registry, ...none }, lineage);
    expect(landed()).toEqual(['events-lg.tsv', 'ledger-head-lg.json', 'ledger-lg.tsv', 'lineage', 'local-group.json']);
    expect(readFileSync(join(dir, 'ledger-lg.tsv'), 'utf8')).toBe('l');
  });
});
