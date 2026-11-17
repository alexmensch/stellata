// Each spine row's binding settled: the derivation, the collision rule, the review queue and the dispositions that settle it. See README.md#what-the-derivation-cannot-settle-alone.

import type { PrimaryTables } from '../../spine/primaries-audit-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import {
  BINDING_SOURCES,
  isUnconfirmed,
  type DerivedBinding,
  type RowGateEvidence,
} from './binding-derivation-pure';
import type {
  BindingEvidence, SimbadWdsXidIndex,
} from './binding-gate-pure';
import {
  bindingReviewCells,
  identityQueueCandidate,
  type IdentityQueueCandidate,
  boundOutcome,
  heldMoreThanOnce,
  identityWitnessed,
  passingRunnersUp,
  refusedCandidates,
  reviewLetters,
  unshippedCandidates,
  unweighedCandidates,
  type RowDeriver,
  type UnshippedCandidate,
} from './binding-outcomes-pure';
import { bindingReviewKey } from '../ledger-rows-pure';
import { dispositionOf, type BindingDispositionRow } from './binding-review-dispositions-pure';
import {
  CONTESTED_LEADS,
  isQueuedOutcome,
  LED_SPINE_OUTCOMES,
  withLead,
  type KeyedOutcome,
  type MembershipOutcome,
  type PrimariesBindingClass,
} from '../membership-lineage-pure';
import { isSolProper } from '../membership-manifest-tsv';

type BindingOutcome = 'bound' | 'refused' | 'contested' | 'collision' | 'sol';

/** What the derivation reached for one spine row. Sol derives nothing. */
export type SpineBinding =
  | { outcome: 'sol' }
  | DerivedSpineBinding;

interface DerivedSpineBinding {
  outcome: Exclude<BindingOutcome, 'sol'>;
  derived: DerivedBinding;
  gate: RowGateEvidence;
}

/** The value a spine row ships and on what basis. */
export interface SettledBinding {
  value: string | null;
  binding: PrimariesBindingClass;
}

/** One kept spine row's derivation and what it ships. */
export interface SettledSpineRow {
  binding: SpineBinding;
  ships: SettledBinding;
}

export interface SpineSettlement {
  /** Per kept spine row, in order. */
  rows: SettledSpineRow[];
  outcomes: KeyedOutcome[];
  unshipped: UnshippedCandidate[];
  identityQueue: IdentityQueueCandidate[];
}

function bindingOutcome(derived: DerivedBinding, withheld: boolean): BindingOutcome {
  if (withheld) return 'collision';
  if (derived.sourceId === null) return 'refused';
  return passingRunnersUp(derived).length > 0 ? 'contested' : 'bound';
}

/** Withholds any source two rows derive — see README.md. */
function deriveSpineBindings(spine: readonly SpineRow[], derive: RowDeriver): SpineBinding[] {
  const derivations = spine.map((row) => (isSolProper(row.proper) ? null : derive(row)));
  const collisions = heldMoreThanOnce(derivations.map((d) => d?.derived.sourceId ?? null));
  return derivations.map((d): SpineBinding => {
    if (d === null) return { outcome: 'sol' };
    const id = d.derived.sourceId;
    return { ...d, outcome: bindingOutcome(d.derived, id !== null && collisions.has(id)) };
  });
}

function spineBindingOutcome(
  row: SpineRow, b: SpineBinding, tables: PrimaryTables, xids: SimbadWdsXidIndex | null,
): MembershipOutcome {
  const { sourceLetters, hipLetters } = reviewLetters(b.outcome === 'sol' ? null : b.derived.sourceId, row.hip, xids);
  if (b.outcome === 'sol') {
    return {
      kind: 'spine-binding', ...withLead('sol', LED_SPINE_OUTCOMES, [], BINDING_SOURCES),
      sourceId: '', via: '', sourceLetters: '', hipLetters,
    };
  }
  const { derived } = b;
  const sourceId = derived.sourceId;
  const letters = { sourceLetters, hipLetters };
  if (isQueuedOutcome(b.outcome)) {
    return {
      kind: 'spine-binding-queued', ...withLead(b.outcome, LED_SPINE_OUTCOMES, derived.via, CONTESTED_LEADS),
      review: bindingReviewCells(row, b.derived, b.gate, tables), ...letters,
    };
  }
  return {
    kind: 'spine-binding',
    ...withLead(b.outcome === 'bound' ? boundOutcome(derived) : b.outcome, LED_SPINE_OUTCOMES, derived.via, BINDING_SOURCES),
    sourceId: sourceId ?? '',
    via: derived.via.join('+'),
    ...letters,
  };
}

/** See README.md. */
function settleBinding(
  b: DerivedSpineBinding, disposition: BindingDispositionRow | undefined, evidence: BindingEvidence,
): SettledBinding & { asserted: boolean } {
  const { derived } = b;
  if (disposition === undefined) {
    const shippable = b.outcome === 'bound' || b.outcome === 'contested';
    return shippable && derived.sourceId !== null
      ? { value: derived.sourceId, binding: derived.binding, asserted: false }
      : { value: null, binding: 'none', asserted: false };
  }
  const key = bindingReviewKey(disposition);
  if (disposition.derived_source_id !== (derived.sourceId ?? '')) {
    throw new Error(
      `binding-review-dispositions.tsv: row ${key} disposes a derivation reaching `
        + `${disposition.derived_source_id || '(nothing)'}, but it now reaches `
        + `${derived.sourceId || '(nothing)'}; re-review it`,
    );
  }
  const keep = disposition.keep_source_id;
  if (keep === '') return { value: null, binding: 'none', asserted: false };
  const asserted = !derived.ranked.some((c) => c.sourceId === keep);
  // A `simbad_dr2_object` id is in the DR2 namespace, so no DR3 table can carry
  // it; dropping the exemption fails the build on the rows that basis exists for.
  if (asserted && disposition.basis !== 'simbad_dr2_object' && !evidence.hasPulledRow(keep)) {
    throw new Error(
      `binding-review-dispositions.tsv: row ${key} keeps ${keep}, which no source proposes `
        + 'and the Gaia DR3 astrometry catalogue has no row for; re-check the id',
    );
  }
  return { value: keep, binding: 'reviewed', asserted };
}

/** One derived spine row's outcomes past its binding verdict, and what it ships. */
function settleRow(
  row: SpineRow, key: string, b: DerivedSpineBinding,
  disposition: BindingDispositionRow | undefined, evidence: BindingEvidence, tables: PrimaryTables,
): { settled: SettledBinding; outcomes: KeyedOutcome[]; unshipped: UnshippedCandidate[] } {
  const d = b.derived;
  const outcomes: KeyedOutcome[] = [
    ...refusedCandidates(key, 'spine', d),
    ...identityWitnessed(key, 'spine', d),
    ...unweighedCandidates(key, [{ d, cites: [] }]),
    ...d.weighedNullGMag.map((c): KeyedOutcome => ({
      key, outcome: { kind: 'weighed-null-g', sourceId: c.sourceId, via: c.via.join('+') },
    })),
  ];
  if (!d.gateable && d.ranked.length > 0) outcomes.push({ key, outcome: { kind: 'ungateable' } });
  const { asserted, ...settled } = settleBinding(b, disposition, evidence);
  if (disposition !== undefined) {
    if (asserted) {
      outcomes.push({ key, outcome: { kind: 'asserted', keep: disposition.keep_source_id, basis: disposition.basis } });
    }
    outcomes.push({
      key,
      outcome: {
        kind: 'disposition', outcome: dispositionOf(disposition),
        queue: isQueuedOutcome(b.outcome) || isUnconfirmed(d) ? 'queued' : 'settled',
        keep: disposition.keep_source_id, basis: disposition.basis,
        review: bindingReviewCells(row, b.derived, b.gate, tables),
      },
    });
  }
  if (settled.value !== null && settled.value === d.sourceId && d.via.length > 1) {
    outcomes.push({ key, outcome: { kind: 'consensus' } });
  }
  const withheldAs = disposition?.basis === 'pair_component' ? 'component' : 'withheld';
  return { settled, outcomes, unshipped: unshippedCandidates(key, d, settled.value, withheldAs) };
}

export function settleSpineBindings(input: {
  kept: readonly SpineRow[];
  keyOf: (keptRow: number) => string;
  derive: RowDeriver;
  dispositions: ReadonlyMap<string, BindingDispositionRow>;
  evidence: BindingEvidence;
  tables: PrimaryTables;
}): SpineSettlement {
  const { kept, keyOf, dispositions, evidence, tables } = input;
  const bindings = deriveSpineBindings(kept, input.derive);
  const outcomes: KeyedOutcome[] = [];
  const identityQueue: IdentityQueueCandidate[] = [];
  const unshipped: UnshippedCandidate[] = [];
  const applied = new Set<string>();
  const rows = bindings.map((b, i): SettledSpineRow => {
    const row = kept[i];
    const key = keyOf(i);
    outcomes.push({ key, outcome: spineBindingOutcome(row, b, tables, evidence.wdsXids) });
    let s: SettledBinding = { value: null, binding: 'none' };
    if (b.outcome !== 'sol') {
      const reviewKey = bindingReviewKey(row);
      const disposition = dispositions.get(reviewKey);
      if (disposition !== undefined) applied.add(reviewKey);
      const r = settleRow(row, key, b, disposition, evidence, tables);
      if (disposition === undefined && r.settled.value === null) {
        identityQueue.push(...identityQueueCandidate(key, 'spine', row, b.derived, b.gate, tables));
      }
      outcomes.push(...r.outcomes);
      unshipped.push(...r.unshipped);
      s = r.settled;
    }
    outcomes.push({ key, outcome: { kind: 'admit-spine', binding: s.binding } });
    return { binding: b, ships: s };
  });
  for (const key of dispositions.keys()) {
    if (!applied.has(key)) {
      throw new Error(`binding-review-dispositions.tsv: row ${key} disposes no spine row; remove it`);
    }
  }
  const duplicated = heldMoreThanOnce(rows.map((r) => r.ships.value));
  if (duplicated.size > 0) {
    throw new Error(`two spine rows bind one Gaia source: ${[...duplicated].join(', ')}`);
  }
  return { rows, outcomes, unshipped, identityQueue };
}
