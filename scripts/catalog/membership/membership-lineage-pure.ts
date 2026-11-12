// build:membership as a lineage stage: its reason codes, its outcome union, the one serialiser over it, and the four ledgers as views. See README.md#membership-lineage.

import {
  LABEL_DISPOSITIONS, LABEL_FIELDS, type LabelDisposition, type LabelField, type LabelFlip,
} from '../classic-ids/label-merge/label-merge-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import type { DiffJoin } from '../lineage/lineage-diff-pure';
import { lineageInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import { paramsOf, stageRow, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import {
  outcomeCode, refusalCode, retired, stageCodes, LIVE, type CodeDeclaration,
} from '../lineage/reason-codes/reason-codes-pure';
import type { GateReason } from './binding/binding-gate-pure';
import { BINDING_SOURCES, type BindingSource } from './binding/binding-derivation-pure';
import {
  BINDING_REVIEW_COLUMNS, COMPONENT_REASON_PREFIX,
  type AdditionLedgerRow, type AdditionReason, type BindingReviewRow, type BindingReviewVerdict,
  type LabelDropReason, type LabelDropRow, type OwnCandidate, type OwnCandidateReason,
} from './ledger-rows-pure';
import { BINDING_DISPOSITIONS, type BindingDisposition } from './binding-review-dispositions-pure';
import { MEMBERSHIP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const MEMBERSHIP_LINEAGE_BUDGET = { gzipBytes: 41_000_000, writeMs: 20_000 };

const RETIRED_7_1_20 = retired('7.1.20');

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

/** The binding outcomes with a winner, whose code names the highest-precedence source proposing it. */
export const LED_SPINE_OUTCOMES = ['bound', 'rescued', 'contested'] as const;
export const LED_ADDITION_OUTCOMES = ['bound', 'rescued'] as const;
type LedSpineOutcome = (typeof LED_SPINE_OUTCOMES)[number];
type QueuedBranch = `binding.contested.${BindingSource}` | 'binding.collision';
const QUEUED_BRANCHES: readonly (readonly [QueuedBindingOutcome, QueuedBranch])[] = [
  ...BINDING_SOURCES.map((lead) => ['contested', `binding.contested.${lead}`] as const),
  ['collision', 'binding.collision'],
];
type LedAdditionOutcome = (typeof LED_ADDITION_OUTCOMES)[number];

/** An outcome in `Led` carries the source leading its winner; any other carries none. */
type Led<O extends string, L extends O> =
  | { readonly outcome: Exclude<O, L> }
  | { readonly outcome: L; readonly lead: BindingSource };

/** `outcome`, carrying the source leading its winner (`via[0]`) when it is one of `led`. */
export function withLead<O extends string, L extends string>(
  outcome: O, led: readonly L[], via: readonly BindingSource[],
): Led<O, L & O> {
  if (!(led as readonly string[]).includes(outcome)) return { outcome } as Led<O, L & O>;
  const lead = via[0];
  if (lead === undefined) throw new Error(`a ${outcome} binding names no source proposing its winner`);
  return { outcome: outcome as L & O, lead };
}

export const ADDITION_BINDING_OUTCOMES = [
  'bound', 'rescued', 'on-spine', 'shared', 'refused', 'no-candidate',
] as const;
export type AdditionBindingOutcome = (typeof ADDITION_BINDING_OUTCOMES)[number];

export type CandidateRefusal = GateReason | 'runner-up';
/** Whose derivation weighed the refused candidate: a spine row's or an addition group's. */
export type RefusalSubject = 'spine' | 'addition';
const REFUSAL_BRANCHES = {
  spine: {
    mag: 'binding.gate-mag',
    sibling: 'binding.gate-sibling',
    'runner-up': 'binding.runner-up',
  },
  addition: {
    mag: 'addition-binding.gate-mag',
    sibling: 'addition-binding.gate-sibling',
    'runner-up': 'addition-binding.runner-up',
  },
} as const satisfies Record<RefusalSubject, Record<CandidateRefusal, string>>;
type RefusalBranch = (typeof REFUSAL_BRANCHES)[RefusalSubject][CandidateRefusal];

/** Whether the row a disposition settles is on the review queue (`contested`, `collision`) or was settled by the derivation. */
export const DISPOSITION_QUEUES = ['queued', 'settled'] as const;
export type DispositionQueue = (typeof DISPOSITION_QUEUES)[number];
type DispositionBranch = `disposition.${BindingDisposition}.${DispositionQueue}`;

const LABEL_DROP_BRANCHES = {
  flamsteed_unattested: 'label-drop.flamsteed-unattested',
  hd_unattested: 'label-drop.hd-unattested',
} as const satisfies Record<LabelDropReason, string>;

const DISPOSITION_DESCRIPTIONS = {
  derived: 'A committed review disposition confirms the derived Gaia source.',
  other: 'A committed review disposition binds a Gaia source other than the derived one, on its stated evidence.',
  none: 'A committed review disposition leaves the record unbound.',
} as const satisfies Record<BindingDisposition, string>;

const DISPOSITION_QUEUE_DESCRIPTIONS = {
  queued: 'The derivation queued the row for review, as contested or a collision.',
  settled: 'The derivation settled the row by itself; the disposition overrides it.',
} as const satisfies Record<DispositionQueue, string>;

const LABEL_DESCRIPTIONS = {
  added: 'The classic-ID overlay adds a designation the spine row lacked.',
  'overlay-wins': 'The overlay and the spine disagree on a designation, and the overlay\'s value is taken.',
  'override-spine': 'A curated override keeps the spine\'s designation over the overlay\'s.',
  'override-value': 'A curated override sets the designation.',
  'suppressed-collision': 'The overlay\'s designation already names another record, so it is not added.',
  'extra-alias': 'The overlay names a further value for a field, carried as an alias the record answers to.',
  'extra-sibling-rendered': 'The overlay\'s further value belongs to a companion drawn as its own star, so it is left to that star.',
  'extra-dropped': 'The overlay names a further value for a single-valued field; it is dropped.',
} as const satisfies Record<LabelDisposition, string>;

type LabelBranch = `label.${LabelDisposition}.${LabelField}`;
const labelBranch = (d: LabelDisposition, f: LabelField): LabelBranch => `label.${d}.${f}`;

const RETIRED_LABEL_CODES = Object.fromEntries(LABEL_DISPOSITIONS.map(
  (d) => [`label.${d}`, outcomeCode(LABEL_DESCRIPTIONS[d], 'none', RETIRED_7_1_20)],
)) as Record<`label.${LabelDisposition}`, CodeDeclaration<typeof RETIRED_7_1_20>>;

const LABEL_CODES = Object.fromEntries(LABEL_DISPOSITIONS.flatMap((d) => LABEL_FIELDS.map(
  (f) => [labelBranch(d, f), outcomeCode(`${LABEL_DESCRIPTIONS[d]} Identifier: ${f}.`)],
))) as Record<LabelBranch, CodeDeclaration<typeof LIVE>>;

const ADMIT_MAGNITUDE = 'A Gaia DR3 source at or brighter than the V floor that no primaries record binds is admitted.';

const OWN_CANDIDATE_BRANCHES = {
  refused_mag: 'admit.magnitude.refused-mag',
  refused_sibling: 'admit.magnitude.refused-sibling',
  withheld: 'admit.magnitude.withheld',
  runner_up: 'admit.magnitude.runner-up',
  component: 'admit.magnitude.component',
} as const satisfies Record<OwnCandidateReason, string>;

const SPINE_LED_DESCRIPTIONS = {
  bound: 'One Gaia source survives both binding gates with no passing rival, and the record binds to it.',
  rescued: 'Every candidate failed a gate, and SIMBAD files the record\'s own TYC under the one the sibling gate refused, so that one binds.',
  contested: 'The binding winner has a runner-up that also passed both gates; precedence chose it and the row is queued for review.',
} as const satisfies Record<LedSpineOutcome, string>;

const ADDITION_LED_DESCRIPTIONS = {
  bound: 'The admitted star\'s own Gaia source survives both gates and is no other record\'s.',
  rescued: 'The admitted star\'s candidates all failed a gate, and SIMBAD\'s witness under its TYC rescued one.',
} as const satisfies Record<LedAdditionOutcome, string>;

const LEAD_DESCRIPTIONS = {
  tyc: 'The highest-precedence source proposing the winner is the Gaia TYC cross-match.',
  hip: 'The highest-precedence source proposing the winner is the Gaia HIP cross-match.',
  cns5: 'The highest-precedence source proposing the winner is CNS5.',
  simbad: 'The winner rests on SIMBAD\'s cross-IDs alone.',
} as const satisfies Record<BindingSource, string>;

function ledCodes<P extends string, O extends string>(
  prefix: P, descriptions: Readonly<Record<O, string>>,
): Record<`${P}.${O}.${BindingSource}`, CodeDeclaration<typeof LIVE>> {
  return Object.fromEntries(Object.entries<string>(descriptions).flatMap(([outcome, d]) => BINDING_SOURCES.map(
    (lead) => [`${prefix}.${outcome}.${lead}`, outcomeCode(`${d} ${LEAD_DESCRIPTIONS[lead]}`)],
  ))) as Record<`${P}.${O}.${BindingSource}`, CodeDeclaration<typeof LIVE>>;
}

export const MEMBERSHIP_CODES = stageCodes(MEMBERSHIP_LINEAGE.stage, {
  'admit.spine': outcomeCode('An AT-HYG spine row becomes a manifest row on the merge decision it records.'),
  fold: outcomeCode('Review found the spine row duplicates another spine row; it folds onto that row and its SID merges into the survivor\'s.', 'merge'),
  'admit.hd-link-gap': outcomeCode('An IV/25 Tycho-2 star with an HD below 100,000 that AT-HYG never linked is admitted.'),
  'admit.hd-omitted': outcomeCode('An IV/25 Tycho-2 star with an HD of 100,000 or more, outside AT-HYG\'s subset, is admitted.'),
  'admit.hip-omitted': outcomeCode('An I/239 Hipparcos star with no IV/25 entry is admitted.'),
  'admit.cns5-census': outcomeCode('A CNS5 nearby-star census row the spine lacks is admitted.'),
  component: outcomeCode('Every designation the primaries give this star already names another record, so it is ledgered onto that record instead of admitted.'),
  'admit.magnitude': outcomeCode(ADMIT_MAGNITUDE, 'none', RETIRED_7_1_20),
  'admit.magnitude.no-own-candidate': outcomeCode(`${ADMIT_MAGNITUDE} No primaries row weighed it as a binding candidate.`),
  'admit.magnitude.refused-mag': outcomeCode(`${ADMIT_MAGNITUDE} A primaries row's derivation weighed it, and the magnitude gate refused it.`),
  'admit.magnitude.refused-sibling': outcomeCode(`${ADMIT_MAGNITUDE} A primaries row's derivation weighed it, and the sibling gate refused it.`),
  'admit.magnitude.withheld': outcomeCode(`${ADMIT_MAGNITUDE} A primaries row's derivation won it, and the row was withheld from it.`),
  'admit.magnitude.runner-up': outcomeCode(`${ADMIT_MAGNITUDE} A primaries row's derivation passed it, and a higher-ranked candidate won.`),
  'admit.magnitude.component': outcomeCode(`${ADMIT_MAGNITUDE} A primaries row's derivation won it, and review names it the other star of the row's pair.`),
  'binding.bound': outcomeCode(SPINE_LED_DESCRIPTIONS.bound, 'none', RETIRED_7_1_20),
  'binding.rescued': outcomeCode(SPINE_LED_DESCRIPTIONS.rescued, 'none', RETIRED_7_1_20),
  'binding.contested': outcomeCode(SPINE_LED_DESCRIPTIONS.contested, 'none', RETIRED_7_1_20),
  ...ledCodes('binding', SPINE_LED_DESCRIPTIONS),
  'binding.refused': outcomeCode('No Gaia source survives the binding gates; the record ships unbound.'),
  'binding.collision': outcomeCode('Another spine row derives the same Gaia source, so both are withheld and queued for review.'),
  'binding.sol': outcomeCode('The Sun takes no Gaia binding.'),
  'binding.gate-mag': refusalCode('A binding candidate refused because its Gaia G is more than a magnitude fainter than the record\'s printed V.'),
  'binding.gate-sibling': refusalCode('A binding candidate refused because SIMBAD gives that Gaia source to a different component of the record\'s system.'),
  'binding.runner-up': refusalCode('A binding candidate that passed both gates but lost to a higher-ranked one.'),
  'binding.unweighed-no-pulled-row': outcomeCode('A binding candidate the magnitude gate passed unweighed, because the astrometry pull holds no row for it.'),
  'disposition.derived': outcomeCode(DISPOSITION_DESCRIPTIONS.derived, 'none', RETIRED_7_1_20),
  'disposition.other': outcomeCode(DISPOSITION_DESCRIPTIONS.other, 'none', RETIRED_7_1_20),
  'disposition.none': outcomeCode(DISPOSITION_DESCRIPTIONS.none, 'none', RETIRED_7_1_20),
  'disposition.derived.queued': outcomeCode(`${DISPOSITION_DESCRIPTIONS.derived} ${DISPOSITION_QUEUE_DESCRIPTIONS.queued}`),
  'disposition.derived.settled': outcomeCode(`${DISPOSITION_DESCRIPTIONS.derived} ${DISPOSITION_QUEUE_DESCRIPTIONS.settled}`),
  'disposition.other.queued': outcomeCode(`${DISPOSITION_DESCRIPTIONS.other} ${DISPOSITION_QUEUE_DESCRIPTIONS.queued}`),
  'disposition.other.settled': outcomeCode(`${DISPOSITION_DESCRIPTIONS.other} ${DISPOSITION_QUEUE_DESCRIPTIONS.settled}`),
  'disposition.none.queued': outcomeCode(`${DISPOSITION_DESCRIPTIONS.none} ${DISPOSITION_QUEUE_DESCRIPTIONS.queued}`),
  'disposition.none.settled': outcomeCode(`${DISPOSITION_DESCRIPTIONS.none} ${DISPOSITION_QUEUE_DESCRIPTIONS.settled}`),
  'addition-binding.bound': outcomeCode(ADDITION_LED_DESCRIPTIONS.bound, 'none', RETIRED_7_1_20),
  'addition-binding.rescued': outcomeCode(ADDITION_LED_DESCRIPTIONS.rescued, 'none', RETIRED_7_1_20),
  ...ledCodes('addition-binding', ADDITION_LED_DESCRIPTIONS),
  'addition-binding.on-spine': outcomeCode('The admitted star\'s Gaia source is a spine record\'s, so the star ships unbound.'),
  'addition-binding.shared': outcomeCode('Two admitted stars reach the same Gaia source, so neither takes it.'),
  'addition-binding.refused': outcomeCode('Every Gaia candidate of the admitted star failed a binding gate.'),
  'addition-binding.no-candidate': outcomeCode('No catalogue proposes a Gaia source for the admitted star.'),
  'addition-binding.gate-mag': refusalCode('An admitted star\'s binding candidate refused because its Gaia G is more than a magnitude fainter than the star\'s printed V.'),
  'addition-binding.gate-sibling': refusalCode('An admitted star\'s binding candidate refused because SIMBAD gives that Gaia source to a different component of the star\'s system.'),
  'addition-binding.runner-up': refusalCode('An admitted star\'s binding candidate that passed both gates but lost to a higher-ranked one.'),
  ...RETIRED_LABEL_CODES,
  ...LABEL_CODES,
  'label-drop.flamsteed-unattested': outcomeCode('No primary publishes this Flamsteed number for the star, so it leaves the record.'),
  'label-drop.hd-unattested': outcomeCode('No HD primary publishes this HD number for the star, so it leaves the record.'),
});


export type BindingReviewCells = Omit<BindingReviewRow, 'verdict'>;

export type MembershipOutcome =
  | { readonly kind: 'admit-spine' }
  | { readonly kind: 'fold'; readonly survivor: string }
  | { readonly kind: 'admit-addition'; readonly reason: AdditionReason; readonly members: readonly string[] }
  | { readonly kind: 'component'; readonly designation: string; readonly members: readonly string[] }
  | { readonly kind: 'admit-magnitude'; readonly ownCandidate: OwnCandidate | null }
  | ({
    readonly kind: 'spine-binding';
    readonly sourceId: string;
    readonly via: string;
    readonly sourceLetters: string;
    readonly hipLetters: string;
  } & Led<SettledBindingOutcome, LedSpineOutcome & SettledBindingOutcome>)
  | ({
    readonly kind: 'spine-binding-queued';
    readonly review: BindingReviewCells;
    readonly sourceLetters: string;
    readonly hipLetters: string;
  } & Led<QueuedBindingOutcome, LedSpineOutcome & QueuedBindingOutcome>)
  | {
    readonly kind: 'candidate-refused';
    readonly subject: RefusalSubject;
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
    readonly outcome: BindingDisposition;
    readonly queue: DispositionQueue;
    readonly keep: string;
    readonly basis: string;
    readonly review: BindingReviewCells;
  }
  | ({
    readonly kind: 'addition-binding';
    readonly sourceId: string;
    readonly via: string;
  } & Led<AdditionBindingOutcome, LedAdditionOutcome>)
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
  ([
    'admit.spine', 'admit.magnitude.no-own-candidate', ...Object.values(OWN_CANDIDATE_BRANCHES), ...Object.values(ADDITION_BRANCHES),
  ] as const satisfies readonly Branch[])
    .map((b) => MEMBERSHIP_CODES.code(b)),
);

type Letters = { source_letters: string; hip_letters: string };
type Candidate = { source_id: string; via: string };

/** Each code's params, the one declaration its writer and its views share. */
type ParamsOf<B extends Branch> =
  B extends 'component' ? { designation: string }
  : B extends QueuedBranch ? BindingReviewCells & Letters
  : B extends `binding.${LedSpineOutcome}.${BindingSource}` | `binding.${SettledBindingOutcome}` ? { derived_source_id: string; derived_via: string } & Letters
  : B extends RefusalBranch | 'binding.unweighed-no-pulled-row' ? Candidate
  : B extends DispositionBranch ? BindingReviewCells & { keep_source_id: string; basis: string }
  : B extends `addition-binding.${string}` ? Candidate
  : B extends `label-drop.${string}` ? { cell: string; value: string }
  : B extends LabelBranch ? Pick<LabelFlip, 'label' | 'spine' | 'overlay' | 'applied'>
  : Record<string, never>;

function membershipInvariant<B extends Branch>(
  branch: B, holds: string, allows: (params: ParamsOf<B>) => boolean,
): LineageInvariant {
  return lineageInvariant(MEMBERSHIP_CODES, branch, holds, (p) => allows(p as ParamsOf<B>));
}

export const MEMBERSHIP_INVARIANTS: readonly LineageInvariant[] = [
  membershipInvariant(
    'admit.magnitude.withheld',
    'no magnitude-term record is a source a primaries row\'s derivation won and was withheld from (additions/README.md#grouping-and-admission)',
    NO_EXCEPTIONS,
  ),
  membershipInvariant(
    'binding.unweighed-no-pulled-row',
    'every binding candidate is weighed on a row the astrometry pull carries (binding/README.md#the-candidates-have-to-be-in-the-astrometry-pull)',
    NO_EXCEPTIONS,
  ),
];

function row<B extends Branch>(key: string, branch: B, params: ParamsOf<B>, evidence: readonly string[] = []): LineageRow {
  return stageRow(MEMBERSHIP_CODES, key, branch, params as LineageParams, evidence);
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
        ? row(key, 'admit.magnitude.no-own-candidate', {})
        : row(key, OWN_CANDIDATE_BRANCHES[o.ownCandidate.reason], {}, [o.ownCandidate.of]);
    case 'spine-binding':
      return row(key, 'lead' in o ? `binding.${o.outcome}.${o.lead}` : `binding.${o.outcome}`, {
        derived_source_id: o.sourceId, derived_via: o.via, source_letters: o.sourceLetters, hip_letters: o.hipLetters,
      });
    case 'spine-binding-queued':
      return row(key, 'lead' in o ? `binding.${o.outcome}.${o.lead}` : `binding.${o.outcome}`, {
        ...o.review, source_letters: o.sourceLetters, hip_letters: o.hipLetters,
      });
    case 'candidate-refused':
      return row(key, REFUSAL_BRANCHES[o.subject][o.refusal], { source_id: o.sourceId, via: o.via });
    case 'candidate-unweighed':
      return row(key, 'binding.unweighed-no-pulled-row', { source_id: o.sourceId, via: o.via }, o.items);
    case 'disposition':
      return row(key, `disposition.${o.outcome}.${o.queue}`, { ...o.review, keep_source_id: o.keep, basis: o.basis });
    case 'addition-binding':
      return row(key, 'lead' in o ? `addition-binding.${o.outcome}.${o.lead}` : `addition-binding.${o.outcome}`, { source_id: o.sourceId, via: o.via });
    case 'label-flip':
      return row(key, labelBranch(o.flip.disposition, o.flip.field), {
        label: o.flip.label, spine: o.flip.spine,
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
  const flipBranches = new Map<string, { disposition: LabelDisposition; field: LabelField; branch: LabelBranch }>(
    LABEL_DISPOSITIONS.flatMap((d) => LABEL_FIELDS.map(
      (f) => [MEMBERSHIP_CODES.code(labelBranch(d, f)), { disposition: d, field: f, branch: labelBranch(d, f) }] as const,
    )),
  );
  const queued = new Map<string, [QueuedBindingOutcome, QueuedBranch]>(QUEUED_BRANCHES.map(
    ([verdict, branch]) => [MEMBERSHIP_CODES.code(branch), [verdict, branch]],
  ));
  const disposed = byCode(
    BINDING_DISPOSITIONS.flatMap((d) => DISPOSITION_QUEUES.map((q): DispositionBranch => `disposition.${d}.${q}`)),
    (b) => b,
  );
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
    const flip = flipBranches.get(r.code);
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
      out.flips.push({
        sourceId: of(r.key).gaia_source_id, field: flip.field, ...paramsAs(r, flip.branch), disposition: flip.disposition,
      });
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
