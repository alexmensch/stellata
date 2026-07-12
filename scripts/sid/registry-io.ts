// Filesystem access to the committed SID registry under data/sid/: canonical
// paths, the stored same-as edge loader, and a validated read-only load.
// Shared by sid:allocate (the writer), build-catalog, and the sibling stamp.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../util/paths';
import {
  LEDGER_HEADER,
  REINSTATEMENTS_HEADER,
  RETIREMENTS_HEADER,
  isLfsPointer,
  parseLedgerTsv,
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
export const LEDGER_PATH = resolve(SID_DIR, 'ledger.tsv');
export const RETIREMENTS_PATH = resolve(SID_DIR, 'retirements.tsv');
export const REINSTATEMENTS_PATH = resolve(SID_DIR, 'reinstatements.tsv');
export const HEAD_PATH = resolve(SID_DIR, 'ledger-head.json');
export const OVERRIDES_PATH = resolve(SID_DIR, 'sameas-overrides.tsv');
export const SOL_OBJECTS_PATH = resolve(SID_DIR, 'sol-objects.tsv');
export const BRIDGES_DIR = resolve(SID_DIR, 'bridges');

/** The stored (committed) same-as edges: curated overrides plus every
 *  cross-release bridge under bridges/ (docs/sid.md § 4.1). */
export function loadStoredEdges(): SameasEdge[] {
  const edges = parseSameasTsv(readFileSync(OVERRIDES_PATH, 'utf-8'), 'sameas-overrides.tsv');
  if (existsSync(BRIDGES_DIR)) {
    for (const name of readdirSync(BRIDGES_DIR).sort()) {
      if (!name.endsWith('.tsv')) continue;
      edges.push(
        ...parseSameasTsv(readFileSync(resolve(BRIDGES_DIR, name), 'utf-8'), `bridges/${name}`),
      );
    }
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
  const ledgerText = existsSync(LEDGER_PATH)
    ? readFileSync(LEDGER_PATH, 'utf-8')
    : `${LEDGER_HEADER}\n`;
  if (isLfsPointer(ledgerText)) {
    throw new LedgerUnavailableError(
      'data/sid/ledger.tsv is an LFS pointer stub — run `git lfs pull`',
    );
  }
  const retirementsText = existsSync(RETIREMENTS_PATH)
    ? readFileSync(RETIREMENTS_PATH, 'utf-8')
    : `${RETIREMENTS_HEADER}\n`;
  const reinstatementsText = existsSync(REINSTATEMENTS_PATH)
    ? readFileSync(REINSTATEMENTS_PATH, 'utf-8')
    : `${REINSTATEMENTS_HEADER}\n`;
  const ledger = parseLedgerTsv(ledgerText);
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
