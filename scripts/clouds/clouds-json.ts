// public/clouds.json, declared: build:clouds serializes through it, and lineage cites a cloud as `clouds:<slug>`.

import { defineJsonArtifact } from '../util/sources/json-artifact-pure';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { publicRepoPath } from '../util/paths';
import type { CloudsFile } from '../../src/catalog-format/clouds/clouds-schema';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const CLOUDS_JSON = defineJsonArtifact<CloudsFile, { readonly id: string }>({
  file: publicRepoPath(PUBLIC_FILES.clouds),
  hint: SIBLING_ARTIFACTS.clouds.buildHint,
  rowKey: { id: 'clouds', text: (cloud) => cloud.id },
});
