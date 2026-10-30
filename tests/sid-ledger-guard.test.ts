// Append-only CI guard for the SID registry (/docs/sid.md#45-ci-guard):
// structural validity of data/sid/, head-snapshot integrity, and the
// frozen-prefix check against the git merge-base. There is deliberately
// no UPDATE_* escape hatch — a prefix rewrite requires editing this test
// in the same PR with explicit user sign-off.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REASON_CODES } from '../scripts/catalog/lineage/reason-codes-tsv';
import { fileAtMergeBase } from '../scripts/util/git-provenance';
import { REPO_ROOT } from '../scripts/util/paths';
import { artifactText, isReadable, readArtifact } from '../scripts/util/sources/source';
import { ALLOCATE_OUTPUTS } from '../scripts/sid/allocate-outputs';
import { retiredSids, sidSuccessorPairs, validateEvents } from '../scripts/sid/events-pure';
import { EVENTS, eventsFile } from '../scripts/sid/events-tsv';
import { LEDGER, ledgerFile } from '../scripts/sid/ledger-tsv';
import { SHELL_OBJECTS, SOL_OBJECTS } from '../scripts/sid/object-mints-source';
import { SAMEAS_BRIDGES, SAMEAS_OVERRIDES } from '../scripts/sid/sameas-source';
import {
  EMPTY_HEAD_TRIPLE,
  checkAppendOnly,
  computeLedgerHead,
  validateLedger,
  type LedgerHead,
} from '../scripts/sid/sid-pure';

const available = isReadable(LEDGER);

function baseHead(): LedgerHead | null {
  const base = fileAtMergeBase(relative(REPO_ROOT, ALLOCATE_OUTPUTS.files.head));
  return base.kind === 'present' ? JSON.parse(base.text) as LedgerHead : null;
}

describe.skipIf(!available)('sid ledger guard', () => {
  const ledger = () => ledgerFile(artifactText(LEDGER));
  const events = () => eventsFile(artifactText(EVENTS));

  it('ledger and events are structurally valid', () => {
    const rows = ledger().rows;
    const codes = new Set(readArtifact(REASON_CODES).map((e) => e.code));
    expect(validateLedger(rows)).toEqual([]);
    expect(validateEvents(events().rows, rows.length, (code) => codes.has(code))).toEqual([]);
  });

  it('every event code declares the effect its event has', () => {
    const effect = new Map(readArtifact(REASON_CODES).map((e) => [e.code, e.effect]));
    const want = { mint: 'none', reinstate: 'none', retire: 'retire', merge: 'merge' } as const;
    const wrong = events().rows.filter((e) => effect.get(e.code) !== want[e.event]);
    expect(wrong.map((e) => `${e.event} of sid ${e.sid}: ${e.code}`)).toEqual([]);
  });

  it('retired state carries over from the migrated retirement files', () => {
    const rows = events().rows;
    expect(retiredSids(rows).size).toBe(3645);
    expect(sidSuccessorPairs(rows).length).toBe(3400);
    expect(new Set(rows.filter((e) => e.event === 'reinstate').map((e) => e.sid)).size).toBe(17);
  });

  it('stored same-as edges and the mint lists parse under the designation grammar', () => {
    SAMEAS_OVERRIDES.read();
    SAMEAS_BRIDGES.read();
    SOL_OBJECTS.read();
    SHELL_OBJECTS.read();
  });

  it('ledger-head.json exactly matches a recomputation over the working files', () => {
    const head = JSON.parse(readFileSync(ALLOCATE_OUTPUTS.files.head, 'utf-8')) as LedgerHead;
    expect(head).toEqual(computeLedgerHead(ledger(), events()));
  });

  it('the frozen prefix is append-only against the merge-base head', ({ skip }) => {
    const base = baseHead();
    if (base === null) {
      skip('no merge-base ledger-head.json (first PR, shallow clone, or no origin/main)');
      return;
    }
    expect(
      checkAppendOnly(base.ledger, ledger().lines, 'ledger.tsv', { newSidsPastBaseMax: true }),
    ).toEqual([]);
    // A head written before events.tsv existed freezes zero rows: the one
    // migration of retirements.tsv and reinstatements.tsv appends them all.
    expect(
      checkAppendOnly(base.events ?? EMPTY_HEAD_TRIPLE, events().lines, 'events.tsv', {
        newSidsPastBaseMax: false,
      }),
    ).toEqual([]);
  });
});
