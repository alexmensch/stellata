// public/local-group.json, declared: build:local-group serializes through it, and lineage cites a galaxy as `local-group:<slug>`.

import { defineJsonArtifact } from '../util/sources/json-artifact-pure';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { publicRepoPath } from '../util/paths';
import type { LocalGroupFile } from '../../src/catalog-format/local-group/local-group-schema';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

const { rowId, buildHint } = SIBLING_ARTIFACTS['local-group'];

export const LOCAL_GROUP_JSON = defineJsonArtifact<LocalGroupFile, { readonly id: string }, typeof rowId>({
  file: publicRepoPath(PUBLIC_FILES.localGroup),
  hint: buildHint,
  rowKey: { id: rowId, text: (galaxy) => galaxy.id },
});
