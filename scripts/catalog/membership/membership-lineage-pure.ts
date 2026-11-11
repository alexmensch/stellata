// build:membership as a lineage stage: its reason codes, its outcome union, the one serialiser over it, and the four ledgers as views. See README.md#membership-lineage.

import { LABEL_DISPOSITIONS, type LabelDisposition, type LabelFlip } from '../classic-ids/label-merge/label-merge-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import type { DiffJoin } from '../lineage/lineage-diff-pure';
import { lineageInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import { paramsOf, paramsText, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { outcomeCode, refusalCode, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import type { GateReason } from './binding/binding-gate-pure';
import {
  BINDING_REVIEW_COLUMNS, COMPONENT_REASON_PREFIX,
  type AdditionLedgerRow, type AdditionReason, type BindingReviewRow, type BindingReviewVerdict,
  type LabelDropReason, type LabelDropRow, type OwnCandidate, type OwnCandidateReason,
} from './ledger-rows-pure';
import { MEMBERSHIP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const MEMBERSHIP_LINEAGE_BUDGET = { gzipBytes: 41_000_000, writeMs: 20_000 };


const ADDITION_BRANCHES = {
  'admitted:hd_link_gap': 'admit.hd-link-gap',
  'admitted:hd_omitted': 'admit.hd-omitted',
  'admitted:hip_omitted': 'admit.hip-omitted',
  'admitted:cns5_census': 'admit.cns5-census',
} as const satisfies Record<AdditionReason, string>;

export const QUEUED_BINDING_OUTCOMES = ['contested', 'collision'] as const;
export type QueuedBindingOutcome = (typeof QUEUED_BINDING_OUTCOMES)[number];
export const SETTLED_BINDING_OUTCOMES = ['bound', 'rescued', 'refused', 'sol'] as const;
export type SettledBindingOutcome = (typeof SETTLED_BINDING_OUTCOMES)[number];

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

export const MEMBERSHIP_CODES = stageCodes(MEMBERSHIP_LINEAGE.stage, {
  'admit.spine': outcomeCode('An AT-HYG spine row becomes a manifest row on the merge decision it records.'),
  fold: outcomeCode('Review found the spine row duplicates another spine row; it folds onto that row and its SID merges into the survivor\'s.', 'merge'),
  'admit.hd-link-gap': outcomeCode('An IV/25 Tycho-2 star with an HD below 100,000 that AT-HYG never linked is admitted.'),
  'admit.hd-omitted': outcomeCode('An IV/25 Tycho-2 star with an HD of 100,000 or more, outside AT-HYG\'s subset, is admitted.'),
  'admit.hip-omitted': outcomeCode('An I/239 Hipparcos star with no IV/25 entry is admitted.'),
  'admit.cns5-census': outcomeCode('A CNS5 nearby-star census row the spine lacks is admitted.'),
  component: outcomeCode('Every designation the primaries give this star already names another record, so it is ledgered onto that record instead of admitted.'),
  'admit.magnitude': outcomeCode('A Gaia DR3 source at or brighter than the V floor that no primaries record binds is admitted.'),
  'binding.bound': outcomeCode('One Gaia source survives both binding gates with no passing rival, and the record binds to it.'),
  'binding.rescued': outcomeCode('Every candidate failed a gate, and SIMBAD files the record\'s own TYC under the one the sibling gate refused, so that one binds.'),
  'binding.contested': outcomeCode('The binding winner has a runner-up that also passed both gates; precedence chose it and the row is queued for review.'),
  'binding.refused': outcomeCode('No Gaia source survives the binding gates; the record ships unbound.'),
  'binding.collision': outcomeCode('Another spine row derives the same Gaia source, so both are withheld and queued for review.'),
  'binding.sol': outcomeCode('The Sun takes no Gaia binding.'),
  'binding.gate-mag': refusalCode('A binding candidate refused because its Gaia G is more than a magnitude fainter than the record\'s printed V.'),
  'binding.gate-sibling': refusalCode('A binding candidate refused because SIMBAD gives that Gaia source to a different component of the record\'s system.'),
  'binding.runner-up': refusalCode('A binding candidate that passed both gates but lost to a higher-ranked one.'),
  'binding.unweighed-no-pulled-row': outcomeCode('A binding candidate the magnitude gate passed unweighed, because the astrometry pull holds no row for it.'),
  'disposition.derived': outcomeCode('A committed review disposition confirms the derived Gaia source.'),
  'disposition.other': outcomeCode('A committed review disposition binds a Gaia source other than the derived one, on its stated evidence.'),
  'disposition.none': outcomeCode('A committed review disposition leaves the record unbound.'),
  'addition-binding.bound': outcomeCode('The admitted star\'s own Gaia source survives both gates and is no other record\'s.'),
  'addition-binding.rescued': outcomeCode('The admitted star\'s candidates all failed a gate, and SIMBAD\'s witness under its TYC rescued one.'),
  'addition-binding.on-spine': outcomeCode('The admitted star\'s Gaia source is a spine record\'s, so the star ships unbound.'),
  'addition-binding.shared': outcomeCode('Two admitted stars reach the same Gaia source, so neither takes it.'),
  'addition-binding.refused': outcomeCode('Every Gaia candidate of the admitted star failed a binding gate.'),
  'addition-binding.no-candidate': outcomeCode('No catalogue proposes a Gaia source for the admitted star.'),
  'label.added': outcomeCode('The classic-ID overlay adds a designation the spine row lacked.'),
  'label.overlay-wins': outcomeCode('The overlay and the spine disagree on a designation, and the overlay\'s value is taken.'),
  'label.override-spine': outcomeCode('A curated override keeps the spine\'s designation over the overlay\'s.'),
  'label.override-value': outcomeCode('A curated override sets the designation.'),
  'label.suppressed-collision': outcomeCode('The overlay\'s designation already names another record, so it is not added.'),
  'label.extra-alias': outcomeCode('The overlay names a further value for a field, carried as an alias the record answers to.'),
  'label.extra-sibling-rendered': outcomeCode('The overlay\'s further value belongs to a companion drawn as its own star, so it is left to that star.'),
  'label.extra-dropped': outcomeCode('The overlay names a further value for a single-valued field; it is dropped.'),
  'label-drop.flamsteed-unattested': outcomeCode('No primary publishes this Flamsteed number for the star, so it leaves the record.'),
  'label-drop.hd-unattested': outcomeCode('No HD primary publishes this HD number for the star, so it leaves the record.'),
});

const LABEL_BRANCHES = Object.fromEntries(
  LABEL_DISPOSITIONS.map((d) => [d, `label.${d}`]),
) as Record<LabelDisposition, `label.${LabelDisposition}`>;

export type BindingReviewCells = Omit<BindingReviewRow, 'verdict'>;

export type MembershipOutcome =
  | { readonly kind: 'admit-spine' }
  | { readonly kind: 'fold'; readonly survivor: string }
  | { readonly kind: 'admit-addition'; readonly reason: AdditionReason; readonly members: readonly string[] }
  | { readonly kind: 'component'; readonly designation: string; readonly members: readonly string[] }
  | { readonly kind: 'admit-magnitude'; readonly ownCandidate: OwnCandidate | null }
  | {
    readonly kind: 'spine-binding';
    readonly outcome: SettledBindingOutcome;
    readonly sourceId: string;
    readonly via: string;
    readonly sourceLetters: string;
    readonly hipLetters: string;
  }
  | {
    readonly kind: 'spine-binding-queued';
    readonly outcome: QueuedBindingOutcome;
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
    readonly kind: 'candidate-unweighed';
    readonly sourceId: string;
    readonly via: string;
    readonly items: readonly string[];
  }
  | {
    readonly kind: 'disposition';
    readonly outcome: DispositionOutcome;
    readonly keep: string;
    readonly basis: string;
    readonly review: BindingReviewCells;
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

/** The codes of the rows that admit a record into the manifest: what a new SID's mint event carries. */
export const MEMBERSHIP_ADMISSION_CODES: ReadonlySet<string> = new Set(
  (['admit.spine', 'admit.magnitude', ...Object.values(ADDITION_BRANCHES)] as const satisfies readonly Branch[])
    .map((b) => MEMBERSHIP_CODES.code(b)),
);

type Letters = { source_letters: string; hip_letters: string };
type Candidate = { source_id: string; via: string };

/** Each code's params, the one declaration its writer and its views share. */
type ParamsOf<B extends Branch> =
  B extends 'component' ? { designation: string }
  : B extends 'admit.magnitude' ? { own_candidate?: OwnCandidateReason }
  : B extends `binding.${QueuedBindingOutcome}` ? BindingReviewCells & Letters
  : B extends `binding.${SettledBindingOutcome}` ? { derived_source_id: string; derived_via: string } & Letters
  : B extends (typeof REFUSAL_BRANCHES)[CandidateRefusal] | 'binding.unweighed-no-pulled-row' ? Candidate
  : B extends `disposition.${DispositionOutcome}` ? BindingReviewCells & { keep_source_id: string; basis: string }
  : B extends `addition-binding.${AdditionBindingOutcome}` ? Candidate
  : B extends `label-drop.${string}` ? { cell: string; value: string }
  : B extends `label.${LabelDisposition}` ? Pick<LabelFlip, 'field' | 'label' | 'spine' | 'overlay' | 'applied'>
  : Record<string, never>;

export const ALLOWED_OWN_CANDIDATE_REASONS: ReadonlySet<OwnCandidateReason> = new Set<OwnCandidateReason>([
  'refused_mag', 'refused_sibling', 'runner_up', 'component',
]);

function membershipInvariant<B extends Branch>(
  branch: B, holds: string, allows: (params: ParamsOf<B>) => boolean,
): LineageInvariant {
  return lineageInvariant(MEMBERSHIP_CODES, branch, holds, (p) => allows(p as ParamsOf<B>));
}

export const MEMBERSHIP_INVARIANTS: readonly LineageInvariant[] = [
  membershipInvariant(
    'admit.magnitude',
    `no magnitude-term record is a primaries row's unshipped candidate except as ${[...ALLOWED_OWN_CANDIDATE_REASONS].join(', ')}`,
    (p) => p.own_candidate === undefined || ALLOWED_OWN_CANDIDATE_REASONS.has(p.own_candidate),
  ),
  membershipInvariant(
    'binding.unweighed-no-pulled-row',
    'every binding candidate is weighed on a row the astrometry pull carries (binding/README.md#the-candidates-have-to-be-in-the-astrometry-pull)',
    NO_EXCEPTIONS,
  ),
];

function row<B extends Branch>(
  key: string, branch: B, params: ParamsOf<B>, evidence: readonly string[] = [],
  role: LineageRow['role'] = 'outcome',
): LineageRow {
  return {
    stage: MEMBERSHIP_LINEAGE.stage, key, role, code: MEMBERSHIP_CODES.code(branch),
    params: paramsText(params as LineageParams), evidence,
  };
}

function paramsAs<B extends Branch>(r: LineageRow, branch: B): ParamsOf<B> {
  if (r.code !== MEMBERSHIP_CODES.code(branch)) throw new Error(`${r.key}: ${r.code} read as ${branch}`);
  return paramsOf(r) as ParamsOf<B>;
}

export function membershipLineageRow({ key, outcome: o }: KeyedOutcome): LineageRow {
  switch (o.kind) {
    case 'admit-spine': return row(key, 'admit.spine', {});
    case 'fold': return row(key, 'fold', {}, [o.survivor]);
    case 'admit-addition': return row(key, ADDITION_BRANCHES[o.reason], {}, o.members);
    case 'component': return row(key, 'component', { designation: o.designation }, o.members);
    case 'admit-magnitude':
      return o.ownCandidate === null
        ? row(key, 'admit.magnitude', {})
        : row(key, 'admit.magnitude', { own_candidate: o.ownCandidate.reason }, [o.ownCandidate.of]);
    case 'spine-binding':
      return row(key, `binding.${o.outcome}`, {
        derived_source_id: o.sourceId, derived_via: o.via, source_letters: o.sourceLetters, hip_letters: o.hipLetters,
      });
    case 'spine-binding-queued':
      return row(key, `binding.${o.outcome}`, {
        ...o.review, source_letters: o.sourceLetters, hip_letters: o.hipLetters,
      });
    case 'candidate-refused':
      return row(key, REFUSAL_BRANCHES[o.refusal], { source_id: o.sourceId, via: o.via }, [], 'refused');
    case 'candidate-unweighed':
      return row(key, 'binding.unweighed-no-pulled-row', { source_id: o.sourceId, via: o.via }, o.items);
    case 'disposition':
      return row(key, `disposition.${o.outcome}`, { ...o.review, keep_source_id: o.keep, basis: o.basis });
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

function invert<V extends string, B extends Branch>(table: Record<V, B>): Map<string, [V, B]> {
  return new Map(Object.entries<B>(table).map(([v, b]) => [MEMBERSHIP_CODES.code(b), [v as V, b]]));
}

const byCode = <V extends string, B extends Branch>(values: readonly V[], branch: (v: V) => B): Map<string, [V, B]> => (
  new Map(values.map((v) => [MEMBERSHIP_CODES.code(branch(v)), [v, branch(v)]]))
);

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
  const queued = byCode(QUEUED_BINDING_OUTCOMES, (o) => `binding.${o}` as const);
  const disposed = byCode(BINDING_DISPOSITION_OUTCOMES, (d) => `disposition.${d}` as const);
  const of = (key: string): IdentityRow => {
    const id = identity.get(key);
    if (id === undefined) throw new Error(`membership lineage: ${key} has no identity row`);
    return id;
  };
  const tuple = (id: IdentityRow) => ({
    tyc: id.tyc, hip: id.hip, hd: id.hd, gl: id.gl, gaia_source_id: id.gaia_source_id,
  });

  const out: MembershipLedgers = { ledger: [], bindingReview: [], labelDrops: [], flips: [] };
  const review = new Map<string, BindingReviewRow>();
  const reviewRow = (verdict: BindingReviewVerdict, cells: BindingReviewCells): BindingReviewRow => (
    Object.fromEntries(BINDING_REVIEW_COLUMNS.map((c) => [c, c === 'verdict' ? verdict : cells[c]])) as BindingReviewRow
  );
  for (const r of rows) {
    const addition = additionReasons.get(r.code);
    const drop = dropReasons.get(r.code);
    const flip = flipDispositions.get(r.code);
    const queue = queued.get(r.code);
    const disposal = disposed.get(r.code);
    if (addition !== undefined) out.ledger.push({ ...tuple(of(r.key)), reason: addition[0] });
    else if (r.code === MEMBERSHIP_CODES.code('component')) {
      const { designation } = paramsAs(r, 'component');
      out.ledger.push({ ...tuple(of(r.key)), reason: `${COMPONENT_REASON_PREFIX}${designation}` });
    } else if (drop !== undefined) {
      const { cell, value } = paramsAs(r, drop[1]);
      out.labelDrops.push({ ...tuple(of(r.key)), cell, value, reason: drop[0] });
    } else if (flip !== undefined) {
      out.flips.push({ sourceId: of(r.key).gaia_source_id, ...paramsAs(r, flip[1]), disposition: flip[0] });
    } else if (queue !== undefined) {
      review.set(r.key, reviewRow(queue[0], paramsAs(r, queue[1])));
    } else if (disposal !== undefined && !review.has(r.key)) {
      review.set(r.key, reviewRow('disposed', paramsAs(r, disposal[1])));
    }
  }
  out.bindingReview.push(...review.values());
  return out;
}

export interface MultiplesComponent {
  readonly systemId: string;
  readonly comp: string;
  readonly hip: number | null;
}

/** A key's identity row: the current build's, else the baseline's, read only on the first key the build lacks. */
export function identityLookup(
  current: readonly IdentityRow[], baseline: () => Iterable<IdentityRow>,
): (key: string) => IdentityRow | undefined {
  let now: Map<string, IdentityRow> | undefined;
  let before: Map<string, IdentityRow> | undefined;
  return (key) => {
    now ??= new Map(current.map((r) => [r.key, r]));
    const row = now.get(key);
    if (row !== undefined) return row;
    before ??= new Map([...baseline()].map((r) => [r.key, r]));
    return before.get(key);
  };
}

/** The change report's `multiples` column: the multiples.tsv components the
 *  record's HIP names, read off its columns until binaries' Binding
 *  provenance carries the join. */
export function multiplesComponentJoin(
  identityOf: (key: string) => IdentityRow | undefined, multiples: readonly MultiplesComponent[],
): DiffJoin {
  const byHip = new Map<string, string[]>();
  for (const m of multiples) {
    if (m.hip === null) continue;
    const list = byHip.get(String(m.hip)) ?? [];
    list.push(`${m.systemId}/${m.comp}`);
    byHip.set(String(m.hip), list);
  }
  return {
    name: 'multiples',
    of: (key) => {
      const hip = identityOf(key)?.hip ?? '';
      return hip === '' ? '' : (byHip.get(hip) ?? []).join('|');
    },
  };
}
