import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { assertTablesFit, batchQueries, describePull, type Pull } from '../pull/pull';
import { rowOrder } from '../pull/columns-pure';
import { committedRows, recordedTableCases, type RecordedAsu } from '../pull/recorded-reply';
import { VIZIER } from '../pull/tap-pure';
import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { CLASSIC_IDS_PULL, GLIESE_PULL, HIP2_PULL, HIP_VMAG_PULL, MSC_PULL } from './vizier';
import {
  BSC5, CNS5, CROSS_INDEX, GLIESE, HIP2, HIP_MAIN_VMAG, MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS, TYC2_HD, type VizierTable,
} from './vizier-pure';

const TABLES = [
  { name: 'tyc2Hd', file: DATA_FILES.tyc2Hd, table: TYC2_HD },
  { name: 'crossIndex', file: DATA_FILES.crossIndex, table: CROSS_INDEX },
  { name: 'bsc5', file: DATA_FILES.bsc5, table: BSC5 },
  { name: 'cns5', file: DATA_FILES.cns5, table: CNS5 },
  { name: 'hipMainVmag', file: DATA_FILES.hipMainVmag, table: HIP_MAIN_VMAG },
  { name: 'hip2', file: DATA_FILES.hip2, table: HIP2 },
  { name: 'gliese', file: DATA_FILES.gliese, table: GLIESE },
  { name: 'systems', file: DATA_FILES.mscSystems, table: MSC_SYSTEMS },
  { name: 'orbits', file: DATA_FILES.mscOrbits, table: MSC_ORBITS },
  { name: 'components', file: DATA_FILES.mscComponents, table: MSC_COMPONENTS },
] as const;

/** Recorded from the CfA mirror, a few rows each (README.md#replies). */
const recorded = (name: string, table: VizierTable): RecordedAsu => {
  if (table.scope.kind !== 'whole-table' || table.scope.asu === undefined) throw new Error(`${name} has no ASU form`);
  return { stem: join(REPO_ROOT, `scripts/refresh/vizier/${name}.cfa`), asu: table.scope.asu };
};

describe.each(TABLES)('$name', ({ name, file, table }) => {
  recordedTableCases(name, file, table, recorded(name, table));
});

const TIED_ON_KEYS = TABLES.filter(({ name }) => ['tyc2Hd', 'systems', 'orbits', 'components'].includes(name));

describe.each(TIED_ON_KEYS)('$name', ({ name, file, table }) => {
  it.skipIf(!lfsContentReadable(join(REPO_ROOT, file)))('ties no two distinct committed lines under its sort', () => {
    const { lines, rows } = committedRows(file);
    const order = rowOrder(table.columns, table.sortBy, name);
    const tied = rows.slice(1).flatMap((row, i) => (order(rows[i], row) === 0 && lines[i] !== lines[i + 1] ? [lines[i + 1]] : []));
    expect(tied).toEqual([]);
  });
});

const PULLS: readonly Pull<string>[] = [CLASSIC_IDS_PULL, HIP_VMAG_PULL, GLIESE_PULL, HIP2_PULL, MSC_PULL];

describe('the pulls', () => {
  it('ask each table in one quoted query to CDS, and as the same whole table of CfA\'s ASU', () => {
    for (const pull of PULLS) {
      for (const table of Object.values(pull.tables)) {
        const queries = batchQueries(table, VIZIER.quote);
        expect(queries).toHaveLength(1);
        expect(queries[0]).toMatch(/ FROM "[^"]+"$/);
      }
      expect(describePull(pull).services).toEqual(['CDS', 'CfA']);
    }
    for (const { table } of TABLES) {
      const asu = table.scope.kind === 'whole-table' ? table.scope.asu : undefined;
      expect(asu?.source).toBe(table.vizierId);
      expect(asu?.columns.map((c) => c.name)).toEqual(table.columns.map((c) => c.name));
      expect(asu?.constraints).toEqual({});
    }
  });

  it('order each table totally: its keys, then every other column as text', () => {
    expect(TYC2_HD.sortBy.map((k) => `${k.column}:${k.as}`)).toEqual([
      'tyc1:integer', 'tyc2:integer', 'tyc3:integer', 'hd:text', 'n_hd:text', 'n_tyc:text',
    ]);
    for (const { table } of TABLES) expect(new Set(table.sortBy.map((k) => k.column))).toEqual(new Set(table.columns.map((c) => c.name)));
  });

  it('hold every row within the table cell cap', () => {
    for (const pull of PULLS) expect(() => assertTablesFit(pull)).not.toThrow();
  });
});
