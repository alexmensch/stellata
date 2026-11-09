// A table pulled over the catalogue's deep population: a magnitude leg joined to gaia_source, plus the request's remainder. See README.md#the-deep-population.

import type { Check, DeclaredOutputs } from '../../util/emit-artifacts';
import { GAIA_REQUEST_BATCH } from '../gaia-request/gaia-request-pure';
import { cellReader, type Cell, type Column } from '../pull/columns-pure';
import { bandCheck, coverageCheck, type RowBand, type SpotRow } from '../pull/gates-pure';
import type { Phase, PhasedPull } from '../pull/pull';
import type { TapArchive } from '../pull/tap-pure';
import { GAIA_SOURCE, magnitudeBound } from './magnitude-pure';

/** The least share of the request either leg answers: the magnitude leg's band says nothing about the request leg. */
export const MIN_REQUEST_COVERAGE = 0.9;

export interface DeepPopulationTable {
  readonly from: string;
  /** Every column but `source_id`, which leads the written table and keys both legs. */
  readonly values: readonly Column[];
  /** The magnitude leg's own row band. */
  readonly magnitudeBand: RowBand;
  readonly spotRows: readonly [SpotRow, ...SpotRow[]];
  /** Gates over every written row, beside the two legs' own. */
  readonly checks?: (label: string, cells: readonly Cell[]) => readonly Check[];
}

export interface DeepPopulationPull {
  readonly archive: TapArchive;
  readonly outputs: DeclaredOutputs<'table'>;
  readonly release: string;
  readonly table: DeepPopulationTable;
  /** The catalogue's source_id request. */
  readonly request: readonly bigint[];
}

const SOURCE_ID = 'source_id';

/** The magnitude leg asks every slice of the bound; the request leg only the ids it did not return, so each source answers once. */
export function deepPopulationPull({ archive, outputs, release, table, request }: DeepPopulationPull): PhasedPull<'table'> {
  const columns: readonly [Column, ...Column[]] = [{ name: SOURCE_ID }, ...table.values];
  const joined = (c: Column): Column => ({ ...c, select: `t.${c.name}` });
  const { where, scope } = magnitudeBound('g.phot_g_mean_mag');
  const magnitude: Phase = {
    from: `${table.from} AS t JOIN ${GAIA_SOURCE} AS g ON g.source_id = t.source_id`,
    where,
    columns: [joined(columns[0]), ...table.values.map(joined)],
    scope: { ...scope, maxRows: table.magnitudeBand.max },
  };
  const remainder: Phase = { from: table.from, columns, scope: { kind: 'request', key: SOURCE_ID, batchSize: GAIA_REQUEST_BATCH, rowsPerId: 1 } };
  const label = outputs.files.table;
  const cellOf = cellReader(columns, label);
  const requested = request.map(String);

  return {
    archive,
    outputs,
    release,
    phases: { magnitude, request: remainder },
    tables: {
      table: {
        columns,
        sortBy: [{ column: SOURCE_ID, as: 'integer' }],
        band: { min: table.magnitudeBand.min, max: table.magnitudeBand.max + request.length },
        spotRows: table.spotRows,
      },
    },
    async run(ask, log) {
      const fromMagnitude = await ask(magnitude);
      const seen = new Set(fromMagnitude.map((row) => cellOf(row)(SOURCE_ID)));
      const fromRequest = await ask(remainder, requested.filter((id) => !seen.has(id)));
      const rows = [...fromMagnitude, ...fromRequest];
      const cells = rows.map(cellOf);
      const asked = new Set(requested);
      log(`  ${label}: magnitude leg ${fromMagnitude.length}, request leg adds ${fromRequest.length}`);
      return {
        rows: { table: rows },
        checks: [
          bandCheck(`${label} magnitude leg`, fromMagnitude.length, table.magnitudeBand),
          coverageCheck(`${label} request`, cells.filter((cell) => asked.has(cell(SOURCE_ID) ?? '')), SOURCE_ID, requested.length, {
            groups: [{ name: 'either leg', has: () => true }], floor: MIN_REQUEST_COVERAGE,
          }),
          ...(table.checks?.(label, cells) ?? []),
        ],
      };
    },
  };
}
