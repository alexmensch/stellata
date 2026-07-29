// Append-only CI guard for the SID registry (docs/sid.md § 4.5):
// structural validity of data/sid/, head-snapshot integrity, and the
// frozen-prefix check against the git merge-base. There is deliberately
// no UPDATE_* escape hatch — a prefix rewrite requires editing this test
// in the same PR with explicit user sign-off.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, isLfsPointer } from '../scripts/util/paths';
import {
  EMPTY_HEAD_TRIPLE,
  LEDGER_HEADER,
  REINSTATEMENTS_HEADER,
  RETIREMENTS_HEADER,
  checkAppendOnly,
  computeLedgerHead,
  parseLedgerTsv,
  parseReinstatementsTsv,
  parseRetirementsTsv,
  parseSameasTsv,
  parseSolObjectsTsv,
  splitTsv,
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type LedgerHead,
} from '../scripts/sid/sid-pure';

const SID_DIR = resolve(REPO_ROOT, 'data/sid');
const LEDGER_PATH = resolve(SID_DIR, 'ledger.tsv');
const RETIREMENTS_PATH = resolve(SID_DIR, 'retirements.tsv');
const REINSTATEMENTS_PATH = resolve(SID_DIR, 'reinstatements.tsv');
const HEAD_PATH = resolve(SID_DIR, 'ledger-head.json');

const ledgerText = existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf-8') : null;
// ledger.tsv rides LFS: a checkout without LFS smudging (the bare CI test
// job) sees a pointer stub. The guard runs for real in the build-catalog
// job (lfs: true) and in any local clone.
const available = ledgerText !== null && !isLfsPointer(ledgerText);

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function baseHead(): LedgerHead | null {
  try {
    const mergeBase = git('merge-base', 'HEAD', 'origin/main');
    return JSON.parse(git('show', `${mergeBase}:data/sid/ledger-head.json`)) as LedgerHead;
  } catch {
    return null;
  }
}

describe.skipIf(!available)('sid ledger guard', () => {
  const retirementsText = readFileSync(RETIREMENTS_PATH, 'utf-8');
  const reinstatementsText = existsSync(REINSTATEMENTS_PATH)
    ? readFileSync(REINSTATEMENTS_PATH, 'utf-8')
    : `${REINSTATEMENTS_HEADER}\n`;
  const ledger = () => parseLedgerTsv(ledgerText!);

  it('ledger, retirements, and reinstatements are structurally valid', () => {
    const rows = ledger();
    const retirements = parseRetirementsTsv(retirementsText);
    const reinstatements = parseReinstatementsTsv(reinstatementsText);
    expect(validateLedger(rows)).toEqual([]);
    expect(validateRetirements(retirements, rows, reinstatements)).toEqual([]);
    expect(validateReinstatements(reinstatements, rows, retirements)).toEqual([]);
  });

  it('stored same-as edges and the sol mint list parse under the § 3 grammar', () => {
    parseSameasTsv(
      readFileSync(resolve(SID_DIR, 'sameas-overrides.tsv'), 'utf-8'),
      'sameas-overrides.tsv',
    );
    parseSolObjectsTsv(readFileSync(resolve(SID_DIR, 'sol-objects.tsv'), 'utf-8'));
  });

  it('ledger-head.json exactly matches a recomputation over the working files', () => {
    const head = JSON.parse(readFileSync(HEAD_PATH, 'utf-8')) as LedgerHead;
    expect(head).toEqual(
      computeLedgerHead(ledgerText!, retirementsText, reinstatementsText),
    );
  });

  it('the frozen prefix is append-only against the merge-base head', () => {
    const base = baseHead();
    if (base === null) {
      console.warn(
        'sid-ledger-guard: no merge-base ledger-head.json (first PR, shallow clone, or no ' +
          'origin/main) — append-only check skipped',
      );
      return;
    }
    const ledgerLines = splitTsv(ledgerText!, LEDGER_HEADER, 'ledger.tsv').dataLines;
    const retirementLines = splitTsv(
      retirementsText,
      RETIREMENTS_HEADER,
      'retirements.tsv',
    ).dataLines;
    expect(
      checkAppendOnly(base.ledger, ledgerLines, 'ledger.tsv', { newSidsPastBaseMax: true }),
    ).toEqual([]);
    expect(
      checkAppendOnly(base.retirements, retirementLines, 'retirements.tsv', {
        newSidsPastBaseMax: false,
      }),
    ).toEqual([]);
    const reinstatementLines = splitTsv(
      reinstatementsText,
      REINSTATEMENTS_HEADER,
      'reinstatements.tsv',
    ).dataLines;
    // Heads written before reinstatements.tsv existed freeze zero rows.
    expect(
      checkAppendOnly(
        base.reinstatements ?? EMPTY_HEAD_TRIPLE,
        reinstatementLines,
        'reinstatements.tsv',
        { newSidsPastBaseMax: false },
      ),
    ).toEqual([]);
  });
});
