// The SID registry files allocation writes, keyed for the emitArtifacts declaration of every step that allocates. See README.md.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';

export const REGISTRY_FILES = {
  sidLedger: resolve(REPO_ROOT, 'data/sid/ledger.tsv'),
  sidEvents: resolve(REPO_ROOT, 'data/sid/events.tsv'),
  sidHead: resolve(REPO_ROOT, 'data/sid/ledger-head.json'),
} as const;
