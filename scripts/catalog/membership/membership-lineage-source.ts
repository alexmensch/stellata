// build:membership's lineage files as build:catalog reads them: its stage lines and its identity rows, declared so the catalogue build keys on them.

import { relative } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { identityRows } from '../lineage/identity-pure';
import { LINEAGE_LAYOUT, stageFile } from '../lineage/lineage-layout-pure';
import { lineageLines } from '../lineage/lineage-row-pure';
import { REPO_ROOT } from '../../util/paths';
import { defineSource } from '../../util/sources/source';
import { MEMBERSHIP_LINEAGE } from './membership-lineage-pure';

const HINT = 'Run pnpm run build:membership.';
const file = (stem: string): string => relative(REPO_ROOT, stageFile(LINEAGE_LAYOUT.current, stem));

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
