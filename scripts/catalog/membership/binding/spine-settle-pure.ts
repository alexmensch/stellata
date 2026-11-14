// Each spine row's binding settled: the derivation, the collision rule, the review queue and the dispositions that settle it. See README.md#what-the-derivation-cannot-settle-alone.

import { SOL_PROPER_NAME } from '../../../../src/catalog-format/record/catalog-pure';
import { intCell } from '../../../util/tsv/table-pure';
import type { SimbadXids } from '../../spectral/spectral-resolve';
import type { PrimaryTables } from '../../spine/primaries-audit-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import {
  BINDING_SOURCES,
  type DerivedBinding,
  type RowGateEvidence,
} from './binding-derivation-pure';
import type {
  BindingEvidence, SimbadWdsXidIndex, WdsComponentAttribution,
} from './binding-gate-pure';
import {
  passingRunnersUp,
  refusedCandidates,
  unshippedCandidates,
  unweighedCandidates,
  type RowDeriver,
  type UnshippedCandidate,
} from './binding-outcomes-pure';
import { bindingReviewKey } from '../ledger-rows-pure';
import { dispositionOf, type BindingDispositionRow } from '../binding-review-dispositions-pure';
import {
  CONTESTED_LEADS,
  isQueuedOutcome,
  LED_SPINE_OUTCOMES,
  withLead,
  type BindingReviewCells,
  type KeyedOutcome,
  type MembershipOutcome,
  type PrimariesBindingClass,
} from '../membership-lineage-pure';
import { joinManifestValues } from '../membership-manifest-tsv';

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

export interface SpineSettlement {
  /** Per kept spine row, in order. */
  bindings: SpineBinding[];
  settled: SettledBinding[];
  outcomes: KeyedOutcome[];
  unshipped: UnshippedCandidate[];
}

function bindingOutcome(derived: DerivedBinding, withheld: boolean): BindingOutcome {
  if (withheld) return 'collision';
  if (derived.sourceId === null) return 'refused';
  return passingRunnersUp(derived).length > 0 ? 'contested' : 'bound';
}

/** Withholds any source two rows derive — see README.md. */
function deriveSpineBindings(spine: readonly SpineRow[], derive: RowDeriver): SpineBinding[] {
  const derivations = spine.map((row) => (row.proper === SOL_PROPER_NAME ? null : derive(row)));
  const holders = new Map<string, number>();
  for (const d of derivations) {
    const id = d?.derived.sourceId ?? null;
    if (id !== null) holders.set(id, (holders.get(id) ?? 0) + 1);
  }
  return derivations.map((d): SpineBinding => {
    if (d === null) return { outcome: 'sol' };
    const id = d.derived.sourceId;
    const withheld = id !== null && (holders.get(id) ?? 0) > 1;
    return { ...d, outcome: bindingOutcome(d.derived, withheld) };
  });
}

function xidsCell(xids: SimbadXids | undefined): string {
  if (xids === undefined) return '';
  const parts: string[] = [];
  if (xids.hip !== null) parts.push(`hip:${xids.hip}`);
  if (xids.tyc !== null) parts.push(`tyc:${xids.tyc}`);
  if (xids.gj !== null) parts.push(`gj:${xids.gj}`);
  return joinManifestValues(parts);
}

function magCell(value: number | null): string {
  return value === null ? '' : value.toFixed(3);
}

/** Sol derives nothing, so its cells past the spine's own are empty. */
function bindingReviewCells(row: SpineRow, b: SpineBinding, tables: PrimaryTables): BindingReviewCells {
  const spine = { tyc: row.tyc, hip: row.hip, hd: row.hd, hr: row.hr, gl: row.gl };
  if (b.outcome === 'sol') {
    return {
      ...spine, derived_source_id: '', derived_via: '', candidates: '', rejected: '',
      v_mag: '', v_via: '', derived_g: '', derived_simbad: '',
    };
  }
  const { derived, gate } = b;
  const gOf = (id: string | null): string => magCell(id === null ? null : gate.evidence.gMagOf(id));
  const xidsOf = (id: string | null): string => xidsCell(id === null ? undefined : tables.simbadBySourceId.get(id));
  const candidates = derived.ranked.flatMap((c) => c.via.map((v) => `${v}:${c.sourceId}`));
  return {
    ...spine,
    derived_source_id: derived.sourceId ?? '',
    derived_via: derived.via.join('+'),
    candidates: joinManifestValues(candidates),
    rejected: joinManifestValues(derived.rejected.map((r) => `${r.sourceId}:${r.reason}`)),
    v_mag: magCell(gate.printedV?.vMag ?? null),
    v_via: gate.printedV?.vVia ?? '',
    derived_g: gOf(derived.sourceId),
    derived_simbad: xidsOf(derived.sourceId),
  };
}

function wdsLetters(attributions: readonly WdsComponentAttribution[] | undefined): string {
  return joinManifestValues((attributions ?? []).map((a) => `${a.wdsId}:${a.component}`));
}

function spineBindingOutcome(
  row: SpineRow, b: SpineBinding, tables: PrimaryTables, xids: SimbadWdsXidIndex | null,
): MembershipOutcome {
  const derived = b.outcome === 'sol' ? null : b.derived;
  const sourceId = derived?.sourceId ?? null;
  const letters = {
    sourceLetters: sourceId === null ? '' : wdsLetters(xids?.bySource.get(sourceId)),
    hipLetters: wdsLetters(xids?.byHip.get(intCell(row.hip) ?? -1)),
  };
  if (isQueuedOutcome(b.outcome)) {
    return {
      kind: 'spine-binding-queued', ...withLead(b.outcome, LED_SPINE_OUTCOMES, derived?.via ?? [], CONTESTED_LEADS),
      review: bindingReviewCells(row, b, tables), ...letters,
    };
  }
  return {
    kind: 'spine-binding',
    ...withLead(b.outcome === 'bound' && derived?.rescued ? 'rescued' : b.outcome, LED_SPINE_OUTCOMES, derived?.via ?? [], BINDING_SOURCES),
    sourceId: sourceId ?? '',
    via: derived?.via.join('+') ?? '',
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
        queue: isQueuedOutcome(b.outcome) ? 'queued' : 'settled',
        keep: disposition.keep_source_id, basis: disposition.basis,
        review: bindingReviewCells(row, b, tables),
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
  const unshipped: UnshippedCandidate[] = [];
  const applied = new Set<string>();
  const settled = bindings.map((b, i): SettledBinding => {
    const row = kept[i];
    const key = keyOf(i);
    outcomes.push({ key, outcome: spineBindingOutcome(row, b, tables, evidence.wdsXids) });
    let s: SettledBinding = { value: null, binding: 'none' };
    if (b.outcome !== 'sol') {
      const reviewKey = bindingReviewKey(row);
      const disposition = dispositions.get(reviewKey);
      if (disposition !== undefined) applied.add(reviewKey);
      const r = settleRow(row, key, b, disposition, evidence, tables);
      outcomes.push(...r.outcomes);
      unshipped.push(...r.unshipped);
      s = r.settled;
    }
    outcomes.push({ key, outcome: { kind: 'admit-spine', binding: s.binding } });
    return s;
  });
  for (const key of dispositions.keys()) {
    if (!applied.has(key)) {
      throw new Error(`binding-review-dispositions.tsv: row ${key} disposes no spine row; remove it`);
    }
  }
  const held = new Map<string, number>();
  for (const s of settled) {
    if (s.value !== null) held.set(s.value, (held.get(s.value) ?? 0) + 1);
  }
  const duplicated = [...held].filter(([, n]) => n > 1).map(([id]) => id);
  if (duplicated.length > 0) {
    throw new Error(`two spine rows bind one Gaia source: ${duplicated.join(', ')}`);
  }
  return { bindings, settled, outcomes, unshipped };
}
