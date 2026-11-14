// What a primaries row's binding derivation records — spine and addition alike: the one deriver, the candidates it weighed and did not take, and the unshipped candidates the magnitude term reads. See README.md.

import {
  bindingCandidates,
  deriveBinding,
  indexSimbadSources,
  rowGateEvidence,
  type BindingCells,
  type DerivedBinding,
  type RankedCandidate,
  type RowGateEvidence,
} from './binding-derivation-pure';
import type { BindingEvidence } from './binding-gate-pure';
import type { PrimaryIndex, PrimaryTables } from '../../spine/primaries-audit-pure';
import type { OwnCandidate, OwnCandidateReason } from '../ledger-rows-pure';
import type { KeyedOutcome, RefusalSubject } from '../membership-lineage-pure';

export type RowDeriver = (row: BindingCells) => { derived: DerivedBinding; gate: RowGateEvidence };

/** The one derivation every primaries row — spine or addition — binds through. */
export function rowDeriver(tables: PrimaryTables, idx: PrimaryIndex, evidence: BindingEvidence): RowDeriver {
  const simbad = indexSimbadSources(tables.simbadBySourceId, tables.simbadSourceless);
  return (row) => {
    const gate = rowGateEvidence(row, evidence, simbad);
    return { derived: deriveBinding(bindingCandidates(row, tables, idx.cns5ByOwnKey, simbad), gate), gate };
  };
}

/** Candidates the gates passed that did not win — a disagreement between
 *  sources the precedence order settled rather than the evidence. Sound only
 *  because `deriveBinding` weighs every ranked candidate: a candidate it left
 *  unweighed would read as passing here on a verdict never taken. */
export function passingRunnersUp(d: DerivedBinding): RankedCandidate[] {
  return d.ranked.filter((c) => c.sourceId !== d.sourceId
    && !d.rejected.some((r) => r.sourceId === c.sourceId));
}

/** A source some primaries row's derivation proposed and did not ship. */
export interface UnshippedCandidate {
  readonly sourceId: string;
  readonly candidate: OwnCandidate;
}

/** Every candidate a row's derivation proposed other than the value it ships,
 *  with why it was not shipped. */
export function unshippedCandidates(
  of: string, d: DerivedBinding, shipped: string | null, withheldAs: OwnCandidateReason = 'withheld',
): UnshippedCandidate[] {
  return d.ranked.flatMap((c): UnshippedCandidate[] => {
    if (c.sourceId === shipped) return [];
    const refusal = d.rejected.find((r) => r.sourceId === c.sourceId);
    const reason: OwnCandidateReason = refusal !== undefined
      ? `refused_${refusal.reason}`
      : c.sourceId === d.sourceId ? withheldAs : 'runner_up';
    return [{ sourceId: c.sourceId, candidate: { reason, of } }];
  });
}

/** By source, the first row to leave each one unshipped, in phase order. */
export function ownCandidates(unshipped: readonly UnshippedCandidate[]): Map<string, OwnCandidate> {
  const out = new Map<string, OwnCandidate>();
  for (const u of unshipped) {
    if (!out.has(u.sourceId)) out.set(u.sourceId, u.candidate);
  }
  return out;
}

/** The candidates a derivation weighed and did not take: each gate refusal,
 *  and each runner-up that passed. */
export function refusedCandidates(key: string, subject: RefusalSubject, d: DerivedBinding): KeyedOutcome[] {
  const refused = d.rejected.map((r): KeyedOutcome => ({
    key,
    outcome: { kind: 'candidate-refused', subject, refusal: r.reason, sourceId: r.sourceId, via: r.via.join('+') },
  }));
  const runnersUp = passingRunnersUp(d).map((c): KeyedOutcome => ({
    key,
    outcome: { kind: 'candidate-refused', subject, refusal: 'runner-up', sourceId: c.sourceId, via: c.via.join('+') },
  }));
  return [...refused, ...runnersUp];
}

/** One row per source a record's derivations weighed with no pulled row, citing
 *  the non-anchor addition items whose own derivation weighed it. */
export function unweighedCandidates(
  key: string, weighedBy: readonly { d: DerivedBinding; cites: readonly string[] }[],
): KeyedOutcome[] {
  const bySource = new Map<string, { via: string; items: Set<string> }>();
  for (const { d, cites } of weighedBy) {
    for (const c of d.unweighedNoPulledRow) {
      const entry = bySource.get(c.sourceId) ?? { via: c.via.join('+'), items: new Set<string>() };
      for (const at of cites) entry.items.add(at);
      bySource.set(c.sourceId, entry);
    }
  }
  return [...bySource].map(([sourceId, { via, items }]): KeyedOutcome => ({
    key, outcome: { kind: 'candidate-unweighed', sourceId, via, items: [...items].sort() },
  }));
}
