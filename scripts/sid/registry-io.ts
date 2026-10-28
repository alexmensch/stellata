// Filesystem access to the committed SID registry under data/sid/: canonical
// paths, the stored same-as edge loader, and a validated read-only load.
// Shared by sid:allocate (the writer), build-catalog, and the sibling stamp.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, isLfsPointer, readRequired } from '../util/paths';
import { LEDGER } from './ledger-tsv';
import {
  parseReinstatementsTsv,
  parseRetirementsTsv,
  parseSameasTsv,
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type LedgerRow,
  type ReinstatementRow,
  type RetirementRow,
  type SameasEdge,
} from './sid-pure';

export const SID_DIR = resolve(ROOT, 'data/sid');
export const LEDGER_PATH = resolve(ROOT, LEDGER.file);
export const RETIREMENTS_PATH = resolve(SID_DIR, 'retirements.tsv');
export const REINSTATEMENTS_PATH = resolve(SID_DIR, 'reinstatements.tsv');
export const HEAD_PATH = resolve(SID_DIR, 'ledger-head.json');
export const SAMEAS_OVERRIDES_FILE = 'data/sid/sameas-overrides.tsv';
export const OVERRIDES_PATH = resolve(ROOT, SAMEAS_OVERRIDES_FILE);
export const SOL_OBJECTS_PATH = resolve(SID_DIR, 'sol-objects.tsv');
export const SHELL_OBJECTS_PATH = resolve(SID_DIR, 'shell-objects.tsv');
export const BRIDGES_DIR = resolve(SID_DIR, 'bridges');

/** The stored (committed) same-as edges: curated overrides plus every
 *  cross-release bridge under bridges/ (/docs/sid.md#41-same-as-equivalence-graph). */
export function loadStoredEdges(): SameasEdge[] {
  const edges = parseSameasTsv(readFileSync(OVERRIDES_PATH, 'utf-8'), SAMEAS_OVERRIDES_FILE);
  for (const name of readdirSync(BRIDGES_DIR).sort()) {
    if (!name.endsWith('.tsv')) continue;
    edges.push(
      ...parseSameasTsv(readFileSync(resolve(BRIDGES_DIR, name), 'utf-8'), `data/sid/bridges/${name}`),
    );
  }
  return edges;
}

export interface Registry {
  ledger: LedgerRow[];
  retirements: RetirementRow[];
  reinstatements: ReinstatementRow[];
  storedEdges: SameasEdge[];
}

/** ledger.tsv is unavailable as an unsmudged LFS pointer — the bare CI
 *  `test` job. Read-only consumers catch this to self-skip rather than
 *  crash (the sid-ledger guard + Sol pin test both do). */
export class LedgerUnavailableError extends Error {}

/** Load + structurally validate the committed registry for a read-only
 *  consumer. Throws LedgerUnavailableError when ledger.tsv is an LFS stub. */
export function loadRegistry(): Registry {
  const ledgerText = readRequired(LEDGER_PATH, 'It is committed under data/sid/ (/docs/sid.md#43-ledger--datasidledgertsv).');
  if (isLfsPointer(ledgerText)) {
    throw new LedgerUnavailableError(
      'data/sid/ledger.tsv is an LFS pointer stub — run `git lfs pull`',
    );
  }
  const retirementsText = readRequired(RETIREMENTS_PATH, 'It is committed under data/sid/ (/docs/sid.md#43-ledger--datasidledgertsv).');
  const reinstatementsText = readRequired(REINSTATEMENTS_PATH, 'It is committed under data/sid/ (/docs/sid.md#43-ledger--datasidledgertsv).');
  const ledger = LEDGER.parse(ledgerText);
  const retirements = parseRetirementsTsv(retirementsText);
  const reinstatements = parseReinstatementsTsv(reinstatementsText);
  const errors = [
    ...validateLedger(ledger),
    ...validateRetirements(retirements, ledger, reinstatements),
    ...validateReinstatements(reinstatements, ledger, retirements),
  ];
  if (errors.length > 0) {
    throw new Error(`SID registry is structurally invalid:\n  ${errors.join('\n  ')}`);
  }
  return { ledger, retirements, reinstatements, storedEdges: loadStoredEdges() };
}
