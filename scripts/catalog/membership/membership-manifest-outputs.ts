// Every file build:membership writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT as ROOT } from '../../util/paths';
import { LABEL_FLIPS_FILE } from '../classic-ids/label-merge/label-merge-pure';
import {
  ADDITIONS_LEDGER_FILE,
  BINDING_REVIEW_FILE,
  LABEL_DROPS_FILE,
  MEMBERSHIP_MANIFEST_FILE,
} from './membership-manifest-pure';

export const MEMBERSHIP_OUTPUTS = declareOutputs({
  labelFlips: resolve(ROOT, LABEL_FLIPS_FILE),
  manifest: resolve(ROOT, MEMBERSHIP_MANIFEST_FILE),
  additions: resolve(ROOT, ADDITIONS_LEDGER_FILE),
  bindingReview: resolve(ROOT, BINDING_REVIEW_FILE),
  labelDrops: resolve(ROOT, LABEL_DROPS_FILE),
});
