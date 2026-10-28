// Append-only CI guard for the SID registry (/docs/sid.md#45-ci-guard):
// structural validity of data/sid/, head-snapshot integrity, and the
// frozen-prefix check against the git merge-base. There is deliberately
// no UPDATE_* escape hatch — a prefix rewrite requires editing this test
// in the same PR with explicit user sign-off.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../scripts/util/paths';
import { artifactText, isReadable } from '../scripts/util/sources/source';
import { LEDGER, LEDGER_HEAD_FILE, ledgerFile } from '../scripts/sid/ledger-tsv';
import { SHELL_OBJECTS, SOL_OBJECTS } from '../scripts/sid/object-mints-source';
import { REINSTATEMENTS, RETIREMENTS } from '../scripts/sid/registry-source';
import { SAMEAS_BRIDGES, SAMEAS_OVERRIDES } from '../scripts/sid/sameas-source';
import {
  EMPTY_HEAD_TRIPLE,
  checkAppendOnly,
  computeLedgerHead,
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type LedgerHead,
} from '../scripts/sid/sid-pure';

const available = isReadable(LEDGER);

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
    return JSON.parse(git('show', `${mergeBase}:${LEDGER_HEAD_FILE}`)) as LedgerHead;
  } catch {
    return null;
  }
}

describe.skipIf(!available)('sid ledger guard', () => {
  const ledger = () => ledgerFile(artifactText(LEDGER));
  const retirements = () => RETIREMENTS.read();
  const reinstatements = () => REINSTATEMENTS.read();

  it('ledger, retirements, and reinstatements are structurally valid', () => {
    const rows = ledger().rows;
    const retired = retirements().rows;
    const reinstated = reinstatements().rows;
    expect(validateLedger(rows)).toEqual([]);
    expect(validateRetirements(retired, rows, reinstated)).toEqual([]);
    expect(validateReinstatements(reinstated, rows, retired)).toEqual([]);
  });

  it('stored same-as edges and the mint lists parse under the designation grammar', () => {
    SAMEAS_OVERRIDES.read();
    SAMEAS_BRIDGES.read();
    SOL_OBJECTS.read();
    SHELL_OBJECTS.read();
  });

  it('ledger-head.json exactly matches a recomputation over the working files', () => {
    const head = JSON.parse(readFileSync(resolve(REPO_ROOT, LEDGER_HEAD_FILE), 'utf-8')) as LedgerHead;
    expect(head).toEqual(computeLedgerHead(ledger(), retirements(), reinstatements()));
  });

  it('the frozen prefix is append-only against the merge-base head', ({ skip }) => {
    const base = baseHead();
    if (base === null) {
      skip('no merge-base ledger-head.json (first PR, shallow clone, or no origin/main)');
      return;
    }
    const ledgerLines = ledger().lines;
    const retirementLines = retirements().lines;
    expect(
      checkAppendOnly(base.ledger, ledgerLines, 'ledger.tsv', { newSidsPastBaseMax: true }),
    ).toEqual([]);
    expect(
      checkAppendOnly(base.retirements, retirementLines, 'retirements.tsv', {
        newSidsPastBaseMax: false,
      }),
    ).toEqual([]);
    const reinstatementLines = reinstatements().lines;
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
