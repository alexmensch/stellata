// REASON_CODES, the committed reason-code list's codec. See README.md#reason-codes--closed-append-only-generated.

import { byText, defineArtifact } from '../../util/tsv/artifact-pure';
import { CODE_STATUSES, type ReasonCodeEntry } from './reason-code-list-pure';
import { CODE_EFFECTS } from './reason-codes-pure';

export const REASON_CODES_FILE = 'data/lineage/reason-codes.tsv';

export const REASON_CODES = defineArtifact({
  file: REASON_CODES_FILE,
  columns: ['code', 'stage', 'effect', 'status', 'retired_in', 'first_version', 'description'] as const,
  hint: 'Re-run `pnpm run lineage:codes`.',
  order: byText((e: ReasonCodeEntry) => e.code),
  decode: (row): ReasonCodeEntry => ({
    code: row.raw('code'),
    stage: row.raw('stage'),
    effect: row.oneOf('effect', CODE_EFFECTS),
    status: row.oneOf('status', CODE_STATUSES),
    retiredIn: row.raw('retired_in'),
    firstVersion: row.raw('first_version'),
    description: row.raw('description'),
  }),
  encode: (e) => ({
    code: e.code,
    stage: e.stage,
    effect: e.effect,
    status: e.status,
    retired_in: e.retiredIn,
    first_version: e.firstVersion,
    description: e.description,
  }),
});
