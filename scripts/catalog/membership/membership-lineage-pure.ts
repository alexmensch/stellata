// build:membership as a lineage stage: its reason codes, its outcome union, the one serialiser over it, and the four ledgers as views. See ../lineage/README.md#the-membership-stage.

import { LABEL_DISPOSITIONS, type LabelDisposition, type LabelFlip } from '../classic-ids/label-merge/label-merge-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { paramsOf, paramsText, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { LIVE, stageCodes, type CodeDeclaration } from '../lineage/reason-codes-pure';
import type { GateReason } from './binding/binding-gate-pure';
import {
  BINDING_REVIEW_COLUMNS, COMPONENT_REASON_PREFIX,
  type AdditionLedgerRow, type AdditionReason, type BindingReviewRow, type BindingReviewVerdict,
  type LabelDropReason, type LabelDropRow,
} from './ledger-rows-pure';

export const MEMBERSHIP_STAGE = 'membership';

const live = (description: string, effect: CodeDeclaration['effect'] = 'none'): CodeDeclaration => (
  { description, effect, status: LIVE }
);

const ADDITION_BRANCHES = {
  'admitted:hd_link_gap': 'admit.hd-link-gap',
  'admitted:hd_omitted': 'admit.hd-omitted',
  'admitted:hip_omitted': 'admit.hip-omitted',
  'admitted:cns5_census': 'admit.cns5-census',
} as const satisfies Record<AdditionReason, string>;

export const SPINE_BINDING_OUTCOMES = ['bound', 'rescued', 'contested', 'refused', 'collision', 'sol'] as const;
export type SpineBindingOutcome = (typeof SPINE_BINDING_OUTCOMES)[number];

export const ADDITION_BINDING_OUTCOMES = [
  'bound', 'rescued', 'on-spine', 'shared', 'refused', 'no-candidate',
] as const;
export type AdditionBindingOutcome = (typeof ADDITION_BINDING_OUTCOMES)[number];

export type CandidateRefusal = GateReason | 'runner-up';
const REFUSAL_BRANCHES = {
  mag: 'binding.gate-mag',
  sibling: 'binding.gate-sibling',
  'runner-up': 'binding.runner-up',
} as const satisfies Record<CandidateRefusal, string>;

export const BINDING_DISPOSITION_OUTCOMES = ['derived', 'other', 'none'] as const;
export type DispositionOutcome = (typeof BINDING_DISPOSITION_OUTCOMES)[number];

const LABEL_DROP_BRANCHES = {
  flamsteed_unattested: 'label-drop.flamsteed-unattested',
  hd_unattested: 'label-drop.hd-unattested',
} as const satisfies Record<LabelDropReason, string>;

export const MEMBERSHIP_CODES = stageCodes(MEMBERSHIP_STAGE, {
  'admit.spine': live('An AT-HYG spine row becomes a manifest row on the merge decision it records.'),
  fold: live('Review found the spine row duplicates another spine row; it folds onto that row and its SID merges into the survivor\'s.', 'merge'),
  'admit.hd-link-gap': live('An IV/25 Tycho-2 star with an HD below 100,000 that AT-HYG never linked is admitted.'),
  'admit.hd-omitted': live('An IV/25 Tycho-2 star with an HD of 100,000 or more, outside AT-HYG\'s subset, is admitted.'),
  'admit.hip-omitted': live('An I/239 Hipparcos star with no IV/25 entry is admitted.'),
  'admit.cns5-census': live('A CNS5 nearby-star census row the spine lacks is admitted.'),
  component: live('Every designation the primaries give this star already names another record, so it is ledgered onto that record instead of admitted.'),
  'admit.magnitude': live('A Gaia DR3 source at or brighter than the V floor that no primaries record binds is admitted.'),
  'binding.bound': live('One Gaia source survives both binding gates with no passing rival, and the record binds to it.'),
  'binding.rescued': live('Every candidate failed a gate, and SIMBAD files the record\'s own TYC under the one the sibling gate refused, so that one binds.'),
  'binding.contested': live('The binding winner has a runner-up that also passed both gates; precedence chose it and the row is queued for review.'),
  'binding.refused': live('No Gaia source survives the binding gates; the record ships unbound.'),
  'binding.collision': live('Another spine row derives the same Gaia source, so both are withheld and queued for review.'),
  'binding.sol': live('The Sun takes no Gaia binding.'),
  'binding.gate-mag': live('A binding candidate refused because its Gaia G is more than a magnitude fainter than the record\'s printed V.'),
  'binding.gate-sibling': live('A binding candidate refused because SIMBAD gives that Gaia source to a different component of the record\'s system.'),
  'binding.runner-up': live('A binding candidate that passed both gates but lost to a higher-ranked one.'),
  'disposition.derived': live('A committed review disposition confirms the derived Gaia source.'),
  'disposition.other': live('A committed review disposition binds a Gaia source other than the derived one, on its stated evidence.'),
  'disposition.none': live('A committed review disposition leaves the record unbound.'),
  'addition-binding.bound': live('The admitted star\'s own Gaia source survives both gates and is no other record\'s.'),
  'addition-binding.rescued': live('The admitted star\'s candidates all failed a gate, and SIMBAD\'s witness under its TYC rescued one.'),
  'addition-binding.on-spine': live('The admitted star\'s Gaia source is a spine record\'s, so the star ships unbound.'),
  'addition-binding.shared': live('Two admitted stars reach the same Gaia source, so neither takes it.'),
  'addition-binding.refused': live('Every Gaia candidate of the admitted star failed a binding gate.'),
  'addition-binding.no-candidate': live('No catalogue proposes a Gaia source for the admitted star.'),
  'label.added': live('The classic-ID overlay adds a designation the spine row lacked.'),
  'label.overlay-wins': live('The overlay and the spine disagree on a designation, and the overlay\'s value is taken.'),
  'label.override-spine': live('A curated override keeps the spine\'s designation over the overlay\'s.'),
  'label.override-value': live('A curated override sets the designation.'),
  'label.suppressed-collision': live('The overlay\'s designation already names another record, so it is not added.'),
  'label.extra-alias': live('The overlay names a further value for a field, carried as an alias the record answers to.'),
  'label.extra-sibling-rendered': live('The overlay\'s further value belongs to a companion drawn as its own star, so it is left to that star.'),
  'label.extra-dropped': live('The overlay names a further value for a single-valued field; it is dropped.'),
  'label-drop.flamsteed-unattested': live('No primary publishes this Flamsteed number for the star, so it leaves the record.'),
  'label-drop.hd-unattested': live('No HD primary publishes this HD number for the star, so it leaves the record.'),
});

const LABEL_BRANCHES = Object.fromEntries(
  LABEL_DISPOSITIONS.map((d) => [d, `label.${d}`]),
) as Record<LabelDisposition, `label.${LabelDisposition}`>;

/** The binding-review columns a binding row carries, the verdict aside. */
export type BindingReviewCells = Omit<BindingReviewRow, 'verdict'>;

export type MembershipOutcome =
  | { readonly kind: 'admit-spine' }
  | { readonly kind: 'fold'; readonly survivor: string }
  | { readonly kind: 'admit-addition'; readonly reason: AdditionReason; readonly members: readonly string[] }
  | { readonly kind: 'component'; readonly designation: string; readonly members: readonly string[] }
  | { readonly kind: 'admit-magnitude' }
  | {
    readonly kind: 'spine-binding';
    readonly outcome: SpineBindingOutcome;
    readonly review: BindingReviewCells;
    readonly sourceLetters: string;
    readonly hipLetters: string;
  }
  | {
    readonly kind: 'candidate-refused';
    readonly refusal: CandidateRefusal;
    readonly sourceId: string;
    readonly via: string;
  }
  | {
    readonly kind: 'disposition';
    readonly outcome: DispositionOutcome;
    readonly keep: string;
    readonly basis: string;
  }
  | {
    readonly kind: 'addition-binding';
    readonly outcome: AdditionBindingOutcome;
    readonly sourceId: string;
    readonly via: string;
  }
  | { readonly kind: 'label-flip'; readonly flip: Omit<LabelFlip, 'sourceId'> }
  | {
    readonly kind: 'label-drop';
    readonly reason: LabelDropReason;
    readonly cell: string;
    readonly value: string;
  };

export interface KeyedOutcome {
  readonly key: string;
  readonly outcome: MembershipOutcome;
}

type Branch = Parameters<typeof MEMBERSHIP_CODES.code>[0];

function row(
  key: string, branch: Branch, params: LineageParams = {}, evidence: readonly string[] = [],
  role: LineageRow['role'] = 'outcome',
): LineageRow {
  return {
    stage: MEMBERSHIP_STAGE, key, role, code: MEMBERSHIP_CODES.code(branch), params: paramsText(params), evidence,
  };
}

export function membershipLineageRow({ key, outcome: o }: KeyedOutcome): LineageRow {
  switch (o.kind) {
    case 'admit-spine': return row(key, 'admit.spine');
    case 'fold': return row(key, 'fold', {}, [o.survivor]);
    case 'admit-addition': return row(key, ADDITION_BRANCHES[o.reason], {}, o.members);
    case 'component': return row(key, 'component', { designation: o.designation }, o.members);
    case 'admit-magnitude': return row(key, 'admit.magnitude');
    case 'spine-binding':
      return row(key, `binding.${o.outcome}`, {
        ...o.review, source_letters: o.sourceLetters, hip_letters: o.hipLetters,
      });
    case 'candidate-refused':
      return row(key, REFUSAL_BRANCHES[o.refusal], { source_id: o.sourceId, via: o.via }, [], 'refused');
    case 'disposition':
      return row(key, `disposition.${o.outcome}`, { keep_source_id: o.keep, basis: o.basis });
    case 'addition-binding':
      return row(key, `addition-binding.${o.outcome}`, { source_id: o.sourceId, via: o.via });
    case 'label-flip':
      return row(key, LABEL_BRANCHES[o.flip.disposition], {
        field: o.flip.field, label: o.flip.label, spine: o.flip.spine,
        overlay: o.flip.overlay, applied: o.flip.applied,
      });
    case 'label-drop':
      return row(key, LABEL_DROP_BRANCHES[o.reason], { cell: o.cell, value: o.value });
    default: {
      const unmapped: never = o;
      throw new Error(`membership outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

function invert<V extends string, B extends string>(table: Record<V, B>): Map<string, V> {
  return new Map(Object.entries<B>(table).map(([v, b]) => [MEMBERSHIP_CODES.code(b as Branch), v as V]));
}

export interface MembershipLedgers {
  ledger: AdditionLedgerRow[];
  bindingReview: BindingReviewRow[];
  labelDrops: LabelDropRow[];
  flips: LabelFlip[];
}

export function membershipLedgers(
  rows: readonly LineageRow[], identity: ReadonlyMap<string, IdentityRow>,
): MembershipLedgers {
  const additionReasons = invert(ADDITION_BRANCHES);
  const dropReasons = invert(LABEL_DROP_BRANCHES);
  const flipDispositions = invert(LABEL_BRANCHES);
  const spineBinding = new Set(SPINE_BINDING_OUTCOMES.map((o) => MEMBERSHIP_CODES.code(`binding.${o}`)));
  const queued = new Set([MEMBERSHIP_CODES.code('binding.contested'), MEMBERSHIP_CODES.code('binding.collision')]);
  const disposed = new Set(BINDING_DISPOSITION_OUTCOMES.map((d) => MEMBERSHIP_CODES.code(`disposition.${d}`)));
  const of = (key: string): IdentityRow => {
    const id = identity.get(key);
    if (id === undefined) throw new Error(`membership lineage: ${key} has no identity row`);
    return id;
  };
  const tuple = (id: IdentityRow) => ({
    tyc: id.tyc, hip: id.hip, hd: id.hd, gl: id.gl, gaia_source_id: id.gaia_source_id,
  });

  const out: MembershipLedgers = { ledger: [], bindingReview: [], labelDrops: [], flips: [] };
  const bindingRows = new Map<string, LineageRow>();
  const disposedKeys = new Set<string>();
  for (const r of rows) {
    const p = paramsOf(r);
    const addition = additionReasons.get(r.code);
    if (addition !== undefined) out.ledger.push({ ...tuple(of(r.key)), reason: addition });
    else if (r.code === MEMBERSHIP_CODES.code('component')) {
      out.ledger.push({ ...tuple(of(r.key)), reason: `${COMPONENT_REASON_PREFIX}${p.designation}` });
    } else if (dropReasons.has(r.code)) {
      out.labelDrops.push({ ...tuple(of(r.key)), cell: p.cell, value: p.value, reason: dropReasons.get(r.code)! });
    } else if (flipDispositions.has(r.code)) {
      out.flips.push({
        sourceId: of(r.key).gaia_source_id, label: p.label, field: p.field as LabelFlip['field'],
        spine: p.spine, overlay: p.overlay, applied: p.applied, disposition: flipDispositions.get(r.code)!,
      });
    } else if (spineBinding.has(r.code)) {
      bindingRows.set(r.key, r);
    } else if (disposed.has(r.code)) disposedKeys.add(r.key);
  }
  for (const [key, r] of bindingRows) {
    const verdict: BindingReviewVerdict | null = queued.has(r.code)
      ? r.code.slice(r.code.lastIndexOf('.') + 1) as BindingReviewVerdict
      : disposedKeys.has(key) ? 'disposed' : null;
    if (verdict === null) continue;
    const p = paramsOf(r);
    out.bindingReview.push(Object.fromEntries(
      BINDING_REVIEW_COLUMNS.map((c) => [c, c === 'verdict' ? verdict : p[c]]),
    ) as BindingReviewRow);
  }
  return out;
}
