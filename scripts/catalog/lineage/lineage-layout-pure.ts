// This checkout's lineage folders, absolute, for the stages' readers and writers. See README.md#run-to-run-diff.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../../util/paths';
import { LINEAGE_REPO_LAYOUT, type LineageLayout } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const LINEAGE_LAYOUT: LineageLayout = {
  current: resolve(REPO_ROOT, LINEAGE_REPO_LAYOUT.current),
  previous: resolve(REPO_ROOT, LINEAGE_REPO_LAYOUT.previous),
  diff: resolve(REPO_ROOT, LINEAGE_REPO_LAYOUT.diff),
};
