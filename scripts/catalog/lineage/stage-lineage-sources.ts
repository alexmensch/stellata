// A lineage stage's current files as sources another step reads: its stage lines and its identity rows.

import { gunzipSync } from 'node:zlib';

import { identityRows } from './identity/identity-pure';
import { lineageLines } from './lineage-row-pure';
import { defineSource } from '../../util/sources/source';
import { LINEAGE_REPO_LAYOUT, stageFile, type IdentityStageSpec } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

/** `hint` names the step that writes the stage. */
export function stageLineageSources<F extends string, S extends F>(spec: IdentityStageSpec<F, S>, hint: string) {
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
