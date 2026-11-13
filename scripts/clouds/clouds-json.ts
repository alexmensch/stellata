// public/clouds.json, declared: build:clouds serializes through it, and lineage cites a cloud as `clouds:<slug>`.

import { defineJsonArtifact } from '../util/sources/json-artifact-pure';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { rerunCommand } from '../util/step-command-pure';
import { publicRepoPath } from '../util/paths';
import type { CloudsFile } from '../../src/catalog-format/clouds/clouds-schema';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

const { rowId } = SIBLING_ARTIFACTS.clouds;

export const CLOUDS_JSON = defineJsonArtifact<CloudsFile, { readonly id: string }, typeof rowId>({
  file: publicRepoPath(PUBLIC_FILES.clouds),
  hint: rerunCommand(SIBLING_ARTIFACTS.clouds.step),
  rowKey: { id: rowId, text: (cloud) => cloud.id },
});
