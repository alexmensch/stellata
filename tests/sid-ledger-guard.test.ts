// Append-only CI guard for the SID registry (/docs/sid.md#45-ci-guard):
// structural validity of every partition, head-snapshot integrity, and the
// frozen-prefix check against the git merge-base. There is deliberately
// no UPDATE_* escape hatch — a prefix rewrite requires editing this test
// in the same PR with explicit user sign-off.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REASON_CODES } from '../scripts/catalog/lineage/reason-codes-tsv';
import { fileAtMergeBase } from '../scripts/util/git-provenance';
import { REPO_ROOT } from '../scripts/util/paths';
import { artifactText, isReadable, readArtifact } from '../scripts/util/sources/source';
import { retiredSids, sidSuccessorPairs } from '../scripts/sid/events-pure';
import { EVENTS, eventsFile } from '../scripts/sid/events-tsv';
import { LEDGERS, ledgerFile } from '../scripts/sid/ledger-tsv';
import { SHELL_OBJECTS, SOL_OBJECTS } from '../scripts/sid/object-mints-source';
import { registryPaths } from '../scripts/sid/registry-outputs';
import { CATALOG_PARTITION, REGISTRY_PARTITIONS } from '../scripts/sid/registry-partitions-pure';
import { unionLedgerLines, validateRegistry } from '../scripts/sid/registry-pure';
import { SAMEAS_BRIDGES, SAMEAS_OVERRIDES } from '../scripts/sid/sameas-source';
import {
  EMPTY_HEAD_TRIPLE,
  checkAppendOnly,
  computeLedgerHead,
  type LedgerHead,
} from '../scripts/sid/sid-pure';

const available = isReadable(LEDGERS[CATALOG_PARTITION]);

function baseHead(partition: string): LedgerHead | null {
  const base = fileAtMergeBase(registryPaths(partition).head);
  return base.kind === 'present' ? JSON.parse(base.text) as LedgerHead : null;
}

describe.skipIf(!available)('sid ledger guard', () => {
  const files = () => REGISTRY_PARTITIONS.map((partition) => ({
    partition,
    ledger: ledgerFile(partition, artifactText(LEDGERS[partition])),
    events: eventsFile(partition, artifactText(EVENTS[partition])),
  }));
  const allEvents = () => files().flatMap((f) => f.events.rows);

  it('every partition is structurally valid, and together they are one dense SID sequence', () => {
    const codes = new Set(readArtifact(REASON_CODES).map((e) => e.code));
    const parts = files().map((f) => ({ partition: f.partition, ledger: f.ledger.rows, events: f.events.rows }));
    expect(validateRegistry(parts, (code) => codes.has(code))).toEqual([]);
  });

  it('every event code declares the effect its event has', () => {
    const effect = new Map(readArtifact(REASON_CODES).map((e) => [e.code, e.effect]));
    const want = { mint: 'none', reinstate: 'none', retire: 'retire', merge: 'merge' } as const;
    const wrong = allEvents().filter((e) => effect.get(e.code) !== want[e.event]);
    expect(wrong.map((e) => `${e.event} of sid ${e.sid}: ${e.code}`)).toEqual([]);
  });

  it('retired state carries over from the migrated retirement files', () => {
    const rows = allEvents();
    expect(retiredSids(rows).size).toBe(3645);
    expect(sidSuccessorPairs(rows).length).toBe(3401);
    expect(new Set(rows.filter((e) => e.event === 'reinstate').map((e) => e.sid)).size).toBe(18);
  });

  it('stored same-as edges and the mint lists parse under the designation grammar', () => {
    SAMEAS_OVERRIDES.read();
    SAMEAS_BRIDGES.read();
    SOL_OBJECTS.read();
    SHELL_OBJECTS.read();
  });

  it('each partition head exactly matches a recomputation over its working files', () => {
    for (const p of REGISTRY_PARTITIONS) {
      const head = JSON.parse(readFileSync(resolve(REPO_ROOT, registryPaths(p).head), 'utf-8')) as LedgerHead;
      expect(head, p).toEqual(computeLedgerHead(artifactText(LEDGERS[p]), artifactText(EVENTS[p])));
    }
  });

  it('the frozen prefix is append-only against the merge-base heads', ({ skip }) => {
    const bases = new Map(REGISTRY_PARTITIONS.map((p) => [p, baseHead(p)]));
    const catalogBase = bases.get(CATALOG_PARTITION);
    if (!catalogBase) {
      skip('no merge-base ledger-head.json (first PR, shallow clone, or no origin/main)');
      return;
    }
    const current = files();
    // A base with no sibling head predates the partitions: its one ledger
    // held every namespace, so the sid-ordered union is what it froze.
    if (REGISTRY_PARTITIONS.every((p) => p === CATALOG_PARTITION || bases.get(p) === null)) {
      expect(checkAppendOnly(
        catalogBase.ledger, unionLedgerLines(current.map((f) => f.ledger.lines)), 'ledger union', { newSidsPastBaseMax: true },
      )).toEqual([]);
    } else {
      for (const f of current) {
        expect(checkAppendOnly(
          bases.get(f.partition)?.ledger ?? EMPTY_HEAD_TRIPLE, f.ledger.lines, registryPaths(f.partition).ledger, { newSidsPastBaseMax: true },
        )).toEqual([]);
      }
    }
    // A head written before events.tsv existed freezes zero rows: the one
    // migration of retirements.tsv and reinstatements.tsv appends them all.
    for (const f of current) {
      expect(checkAppendOnly(
        bases.get(f.partition)?.events ?? EMPTY_HEAD_TRIPLE, f.events.lines, registryPaths(f.partition).events, { newSidsPastBaseMax: false },
      )).toEqual([]);
    }
  });
});
