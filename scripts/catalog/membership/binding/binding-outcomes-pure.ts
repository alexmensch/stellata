// What a primaries row's binding derivation records — spine and addition alike: the one deriver, the candidates it weighed and did not take, and the unshipped candidates the magnitude term reads. See README.md.

import {
  bindingCandidates,
  deriveBinding,
  isUnconfirmed,
  indexSimbadSources,
  rowGateEvidence,
  type BindingCells,
  type DerivedBinding,
  type PositionEvidence,
  type RankedCandidate,
  type RowGateEvidence,
} from './binding-derivation-pure';
import type { BindingEvidence, SimbadWdsXidIndex, WdsComponentAttribution } from './binding-gate-pure';
import type { SimbadXids } from '../../spectral/spectral-resolve';
import { intCell } from '../../../util/tsv/table-pure';
import { joinManifestValues } from '../membership-manifest-tsv';
import { milliCell } from '../../../util/tsv/artifact-pure';
import type { PrimaryIndex, PrimaryTables } from '../../spine/primaries-audit-pure';
import type { OwnCandidate, OwnCandidateReason } from '../ledger-rows-pure';
import type { BindingReviewCells, KeyedOutcome, RefusalSubject } from '../membership-lineage-pure';

export type RowDeriver = (row: BindingCells) => { derived: DerivedBinding; gate: RowGateEvidence };

/** The one derivation every primaries row — spine or addition — binds through. */
export function rowDeriver(
  tables: PrimaryTables, idx: PrimaryIndex, evidence: BindingEvidence, positions: PositionEvidence,
): RowDeriver {
  const simbad = indexSimbadSources(tables.simbadBySourceId, tables.simbadSourceless);
  return (row) => {
    const gate = rowGateEvidence(row, evidence, simbad, positions);
    return { derived: deriveBinding(bindingCandidates(row, tables, idx.cns5ByOwnKey, simbad), gate), gate };
  };
}

const RESCUE_OUTCOMES = { component: 'rescued', identity: 'identified', position: 'positioned' } as const;

/** A winning derivation's outcome: bound outright, or by the witness that rescued it. */
export function boundOutcome(d: DerivedBinding): 'bound' | (typeof RESCUE_OUTCOMES)[keyof typeof RESCUE_OUTCOMES] {
  return d.rescue === null ? 'bound' : RESCUE_OUTCOMES[d.rescue];
}

/** README.md#the-position-witness: Gaia's HIP cross-match names another source than the witness bound. */
export const isPositionDisputed = (d: DerivedBinding): boolean => d.position?.disputedBy != null;

/** A row whose identity witness went unconfirmed: queued only once the magnitude
 *  term admits its source (README.md#identity-outranks-a-blended-magnitude). */
export interface IdentityQueueCandidate {
  key: string;
  subject: RefusalSubject;
  sourceId: string;
  review: BindingReviewCells;
  sourceLetters: string;
  hipLetters: string;
}

export function identityQueueCandidate(
  key: string, subject: RefusalSubject, cells: ReviewKeyCells, d: DerivedBinding, gate: RowGateEvidence, tables: PrimaryTables,
): IdentityQueueCandidate[] {
  if (!isUnconfirmed(d)) return [];
  return [{
    key, subject, sourceId: d.identity.sourceId,
    review: bindingReviewCells(cells, d, gate, tables),
    ...reviewLetters(d.identity.sourceId, cells.hip, gate.evidence.wdsXids),
  }];
}

/** The candidates whose source the magnitude term admitted, as queue rows. */
export function queuedIdentities(
  candidates: readonly IdentityQueueCandidate[], admitted: ReadonlySet<string>,
): KeyedOutcome[] {
  return candidates.filter((c) => admitted.has(c.sourceId)).map((c) => ({
    key: c.key,
    outcome: { kind: 'identity-queued', subject: c.subject, review: c.review, sourceLetters: c.sourceLetters, hipLetters: c.hipLetters },
  }));
}

/** The identity witness's evidence, wherever it named a refused candidate. */
export function identityWitnessed(key: string, subject: RefusalSubject, d: DerivedBinding): KeyedOutcome[] {
  if (d.identity === null) return [];
  return [{ key, outcome: { kind: 'identity-witness', subject, ...d.identity } }];
}

/** The position witness's evidence, wherever it bound the row. */
export function positionWitnessed(key: string, subject: RefusalSubject, d: DerivedBinding): KeyedOutcome[] {
  if (d.position === null) return [];
  const { witness, disputedBy } = d.position;
  return [{ key, outcome: {
    kind: 'position-witness', subject, sourceId: witness.sourceId, separationArcsec: witness.separationArcsec,
    gMag: witness.gMag, vMag: witness.vMag, others: witness.others, disputedBy,
  } }];
}

/** The sources more than one row or group reaches. */
export function heldMoreThanOnce(sourceIds: Iterable<string | null>): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of sourceIds) {
    if (id === null) continue;
    if (seen.has(id)) repeated.add(id);
    else seen.add(id);
  }
  return repeated;
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

function xidsCell(xids: SimbadXids | undefined): string {
  if (xids === undefined) return '';
  const parts: string[] = [];
  if (xids.hip !== null) parts.push(`hip:${xids.hip}`);
  if (xids.tyc !== null) parts.push(`tyc:${xids.tyc}`);
  if (xids.gj !== null) parts.push(`gj:${xids.gj}`);
  return joinManifestValues(parts);
}

/** The designations a review row is keyed and read on. */
export type ReviewKeyCells = Pick<BindingReviewCells, 'tyc' | 'hip' | 'hd' | 'hr' | 'gl'>;

/** A review-queue row's evidence: what the derivation weighed, refused and reached. */
export function bindingReviewCells(
  cells: ReviewKeyCells, derived: DerivedBinding, gate: RowGateEvidence, tables: PrimaryTables,
): BindingReviewCells {
  const gOf = (id: string | null): string => milliCell(id === null ? null : gate.evidence.gMagOf(id));
  const xidsOf = (id: string | null): string => xidsCell(id === null ? undefined : tables.simbadBySourceId.get(id));
  const candidates = derived.ranked.flatMap((c) => c.via.map((v) => `${v}:${c.sourceId}`));
  return {
    tyc: cells.tyc, hip: cells.hip, hd: cells.hd, hr: cells.hr, gl: cells.gl,
    derived_source_id: derived.sourceId ?? '',
    derived_via: derived.via.join('+'),
    candidates: joinManifestValues(candidates),
    rejected: joinManifestValues(derived.rejected.map((r) => `${r.sourceId}:${r.reason}`)),
    v_mag: milliCell(gate.printedV?.vMag ?? null),
    v_via: gate.printedV?.vVia ?? '',
    derived_g: gOf(derived.sourceId),
    derived_simbad: xidsOf(derived.sourceId),
    identity_source_id: derived.identity?.sourceId ?? '',
    identity_g: milliCell(derived.identity?.gMag ?? null),
    identity_separation_arcsec: milliCell(derived.identity?.separationArcsec ?? null),
  };
}

function wdsLetters(attributions: readonly WdsComponentAttribution[] | undefined): string {
  return joinManifestValues((attributions ?? []).map((a) => `${a.wdsId}:${a.component}`));
}

/** SIMBAD's WDS component letters for the derived source and for the row's HIP. */
export function reviewLetters(
  sourceId: string | null, hip: string, xids: SimbadWdsXidIndex | null,
): { sourceLetters: string; hipLetters: string } {
  return {
    sourceLetters: sourceId === null ? '' : wdsLetters(xids?.bySource.get(sourceId)),
    hipLetters: wdsLetters(xids?.byHip.get(intCell(hip) ?? -1)),
  };
}
