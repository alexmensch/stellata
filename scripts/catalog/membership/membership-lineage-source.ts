// build:membership's lineage files as build:catalog reads them: its stage lines and its identity rows, declared so the catalogue build keys on them.

import { gunzipSync } from 'node:zlib';

import { identityRows } from '../lineage/identity-pure';
import { lineageLines } from '../lineage/lineage-row-pure';
import { defineSource } from '../../util/sources/source';
import {
  LINEAGE_REPO_LAYOUT, MEMBERSHIP_LINEAGE, stageFile,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

const HINT = 'Run pnpm run build:membership.';
const file = (stem: string): string => stageFile(LINEAGE_REPO_LAYOUT.current, stem);

export const MEMBERSHIP_STAGE_LINES = defineSource({
  file: file(MEMBERSHIP_LINEAGE.stage),
  hint: HINT,
  parse: (input) => lineageLines(gunzipSync(input.bytes()), input.file),
});

export const MEMBERSHIP_IDENTITY = defineSource({
  file: file(MEMBERSHIP_LINEAGE.identity!),
  hint: HINT,
  parse: (input) => identityRows(gunzipSync(input.bytes()).toString('utf8'), input.file),
});
