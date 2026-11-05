import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APSIS_FIELDS, CATALOG_MANIFEST_FILENAME, HEADER_SIZE, NAME_TABLE_PADDING, NO_APSIS, NO_COMPANION, RECORD_SIZE,
  catalogChunkFilename, writeCatalogHeader, writeStarRecord, type CatalogManifest, type WireStarRecord,
} from '../../src/catalog-format/record/catalog-pure';
import { requestHash } from '../pipeline/freshness';
import { tsManualFixture } from '../pipeline/manual-step-fixture';
import { pipelineTree } from '../pipeline/pipeline-tree';
import { REPO_ROOT } from '../util/paths';
import { catalogColumnsProjection, readCatalogColumns } from './catalog-columns';

let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'catalog-columns-'))); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

type Row = Pick<WireStarRecord, 'x' | 'y' | 'z' | 'absmag' | 'ci'>;

const wire = (row: Row): WireStarRecord => ({
  ...row, vx: 0, vy: 0, vz: 0, physRadius: 1, companionIdx: NO_COMPANION, nameOffset: 0, spectClass: 4, lumClass: 2,
  conIndex: 0, flags: 0, ampUnits: 0, periodUnits: 0, varType: 0, hip: 0, gaiaSourceId: 0n,
  apsis: Object.fromEntries(APSIS_FIELDS.map((f) => [f, NO_APSIS])) as WireStarRecord['apsis'], sid: 1, multiplicityStatus: 0,
});

/** A built catalogue of `rows` in `folder`: one transport chunk and its manifest. Returns the manifest path. */
function writeFixtureCatalogue(folder: string, rows: readonly Row[]): string {
  const recordsAt = HEADER_SIZE + NAME_TABLE_PADDING;
  const totalBytes = recordsAt + rows.length * RECORD_SIZE;
  const view = new DataView(new ArrayBuffer(totalBytes));
  writeCatalogHeader(view, { count: rows.length, nameTableOffset: HEADER_SIZE, nameTableLength: NAME_TABLE_PADDING });
  rows.forEach((row, i) => writeStarRecord(view, recordsAt + i * RECORD_SIZE, wire(row)));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, catalogChunkFilename(0)), new Uint8Array(view.buffer));
  const manifest: CatalogManifest = { chunkBytes: [totalBytes], totalBytes };
  writeFileSync(join(folder, CATALOG_MANIFEST_FILENAME), JSON.stringify(manifest));
  return join(folder, CATALOG_MANIFEST_FILENAME);
}

const VEGA: Row = { x: 1.5, y: -2, z: 7.25, absmag: 0.5, ci: 0 };
const SOL: Row = { x: 0, y: 0, z: 0, absmag: 4.75, ci: 0.625 };

describe('readCatalogColumns', () => {
  it('decodes each named float32 column across every record, in record order', async () => {
    const columns = await readCatalogColumns(['x', 'z', 'absmag'], writeFixtureCatalogue(dir, [SOL, VEGA]));
    expect(columns.count).toBe(2);
    expect([...columns.x]).toEqual([0, 1.5]);
    expect([...columns.z]).toEqual([0, 7.25]);
    expect([...columns.absmag]).toEqual([4.75, 0.5]);
    expect(Object.keys(columns).sort()).toEqual(['absmag', 'count', 'x', 'z']);
  });
});

describe('catalogColumnsProjection', () => {
  const MANIFEST = 'public/catalog-manifest.json';

  it('hashes each named column and names the manifest it projects', async () => {
    writeFixtureCatalogue(join(dir, 'public'), [SOL, VEGA]);
    const projection = await catalogColumnsProjection(['x', 'absmag'], dir);
    expect(projection.requestFrom).toEqual([MANIFEST]);
    expect(projection.request).toEqual([expect.stringMatching(/^x [0-9a-f]{40}$/), expect.stringMatching(/^absmag [0-9a-f]{40}$/)]);
    writeFixtureCatalogue(join(dir, 'public'), [SOL, { ...VEGA, ci: 1.5 }]);
    expect(await catalogColumnsProjection(['x', 'absmag'], dir)).toEqual(projection);
  });

  it('stales a TypeScript bake recorded over it when a catalogue rebuild moves a column it reads, and record.ts freshens it', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFixtureCatalogue(join(dir, 'public'), [SOL, VEGA]);
    const out = join(dir, 'luminosity.txt');
    const fixture = await tsManualFixture(dir, {
      name: 'measure:fixture', kind: { kind: 'bake', describes: true }, out, inputs: [], source: `
import { writeFileSync } from 'node:fs';
import { catalogColumnsProjection, readCatalogColumns } from ${JSON.stringify(join(REPO_ROOT, 'scripts/catalog/catalog-columns'))};
const FIELDS = ['x', 'y', 'z', 'absmag'] as const;
export const describe = () => catalogColumnsProjection(FIELDS, ${JSON.stringify(dir)});
export async function main(): Promise<void> {
  const { absmag } = await readCatalogColumns(FIELDS, ${JSON.stringify(join(dir, MANIFEST))});
  writeFileSync(${JSON.stringify(out)}, String(absmag.reduce((sum, m) => sum + m, 0)));
}
`,
    });

    expect((await fixture.record()).kind).toBe('recorded');
    const { request } = await catalogColumnsProjection(['x', 'y', 'z', 'absmag'], dir);
    expect(JSON.parse(readFileSync(pipelineTree(dir).manualStamp('measure:fixture'), 'utf8'))).toMatchObject({
      request: requestHash(request), requestFrom: [MANIFEST],
    });
    writeFixtureCatalogue(join(dir, 'public'), [SOL, { ...VEGA, ci: 1.5 }]);
    expect(fixture.freshness()).toEqual({ kind: 'fresh' });
    writeFixtureCatalogue(join(dir, 'public'), [SOL, { ...VEGA, absmag: 0.25 }]);
    expect(fixture.freshness()).toEqual({ kind: 'stale', changed: ['(request)'] });
    expect((await fixture.record()).kind).toBe('recorded');
    expect(fixture.freshness()).toEqual({ kind: 'fresh' });
  }, 30_000);
});
