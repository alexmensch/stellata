// REASON_CODES, the committed reason-code list's codec. See README.md.

import { byText, defineArtifact } from '../../../util/tsv/artifact-pure';
import { readTable, type TableRow } from '../../../util/tsv/table-pure';
import { LINEAGE_ROLES } from '../lineage-row-pure';
import { CODE_STATUSES, type ListedCode, type ReasonCodeEntry } from './reason-code-list-pure';
import { CODE_EFFECTS } from './reason-codes-pure';
import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';

const COLUMNS = ['code', 'stage', 'effect', 'role', 'status', 'retired_in', 'first_version', 'description'] as const;
type Column = (typeof COLUMNS)[number];

const LATER_COLUMNS = ['role'] as const satisfies readonly Column[];

function listedCode(row: TableRow<Column>): Omit<ReasonCodeEntry, 'role'> {
  return {
    code: row.raw('code'),
    stage: row.raw('stage'),
    effect: row.oneOf('effect', CODE_EFFECTS),
    status: row.oneOf('status', CODE_STATUSES),
    retiredIn: row.raw('retired_in'),
    firstVersion: row.raw('first_version'),
    description: row.raw('description'),
  };
}

export const REASON_CODES = defineArtifact({
  file: DATA_FILES.reasonCodes,
  columns: COLUMNS,
  hint: 'Re-run `pnpm run lineage:codes`.',
  order: byText((e: ReasonCodeEntry) => e.code),
  decode: (row): ReasonCodeEntry => ({ ...listedCode(row), role: row.oneOf('role', LINEAGE_ROLES) }),
  encode: (e) => ({
    code: e.code,
    stage: e.stage,
    effect: e.effect,
    role: e.role,
    status: e.status,
    retired_in: e.retiredIn,
    first_version: e.firstVersion,
    description: e.description,
  }),
});

/** An older copy of the list, read by its own header: a column it predates reads as absent. */
export function parseListedCodes(text: string): ListedCode[] {
  const columns = COLUMNS.filter((c) => !(LATER_COLUMNS as readonly Column[]).includes(c));
  const table = { file: REASON_CODES.file, columns, optional: LATER_COLUMNS, hint: REASON_CODES.hint };
  return [...readTable<Column>(table, text)].map((row) => (
    row.raw('role') === '' ? listedCode(row) : { ...listedCode(row), role: row.oneOf('role', LINEAGE_ROLES) }
  ));
}
