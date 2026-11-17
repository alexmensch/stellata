// Earlier steps' lineage files as build:catalog's allocation reads them: each stage's lines and identity rows.

import { gunzipSync } from 'node:zlib';

import { identityRows } from './identity/identity-pure';
import { lineageLines } from './lineage-row-pure';
import { defineSource } from '../../util/sources/source';
import {
  LINEAGE_REPO_LAYOUT, MEMBERSHIP_LINEAGE, PAIRS_LINEAGE, stageFile, type IdentityStageSpec,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

function stageLineageSources<F extends string, S extends F>(spec: IdentityStageSpec<F, S>, hint: string) {
  const file = (stem: string): string => stageFile(LINEAGE_REPO_LAYOUT.current, stem);
  return {
    lines: defineSource({
      file: file(spec.stage),
      hint,
      parse: (input) => lineageLines(gunzipSync(input.bytes()), input.file),
    }),
    identity: defineSource({
      file: file(spec.identity),
      hint,
      parse: (input) => identityRows(gunzipSync(input.bytes()).toString('utf8'), input.file),
    }),
  };
}

export const { lines: MEMBERSHIP_STAGE_LINES, identity: MEMBERSHIP_IDENTITY } = stageLineageSources(MEMBERSHIP_LINEAGE, 'Run pnpm run build:membership.');
export const { lines: PAIRS_STAGE_LINES, identity: PAIRS_IDENTITY } = stageLineageSources(PAIRS_LINEAGE, 'Run pnpm run build:binaries.');
