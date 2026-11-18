// The membership ledgers' row shapes and the closed sets the generator and its lineage share. See README.md#files-in-this-area.

import { RECORD_KEY_COLUMNS, type RecordIdentifiers } from '../lineage/identity/identity-pure';

/** The record-parity reason enum (/docs/catalog-driver.md#61-record-parity) for records the primaries admit that the spine lacked. */
export const ADDITION_REASONS = [
  'admitted:hd_link_gap',
  'admitted:hd_omitted',
  'admitted:hip_omitted',
  'admitted:cns5_census',
] as const;
export type AdditionReason = (typeof ADDITION_REASONS)[number];

/** A primary's row whose every designation a spine record already answers to,
 *  so admitting it would make that record's SID key ambiguous. Ledgered onto
 *  the record it resolves to rather than admitted; the suffix is that record's
 *  designation. */
export const COMPONENT_REASON_PREFIX = 'component:';
export type ComponentReason = `${typeof COMPONENT_REASON_PREFIX}${string}`;

export const OWN_CANDIDATE_REASONS = [
  'refused_mag', 'refused_sibling', 'withheld', 'runner_up', 'component',
] as const;
export type OwnCandidateReason = (typeof OWN_CANDIDATE_REASONS)[number];

/** A primaries row's unshipped candidate: why it was not shipped, and the origin key of the row that proposed it. */
export interface OwnCandidate {
  readonly reason: OwnCandidateReason;
  readonly of: string;
}

export const LEDGER_COLUMNS = [...RECORD_KEY_COLUMNS, 'reason'] as const;
export interface AdditionLedgerRow extends RecordIdentifiers {
  reason: AdditionReason | ComponentReason;
}

export const BINDING_REVIEW_VERDICTS = ['contested', 'collision', 'unconfirmed', 'disposed'] as const;
export type BindingReviewVerdict = (typeof BINDING_REVIEW_VERDICTS)[number];
export const BINDING_REVIEW_KEY_COLUMNS = ['tyc', 'hip', 'hd', 'gl'] as const;

/** The record a queue row and its disposition join on. */
export function bindingReviewKey(
  row: Record<(typeof BINDING_REVIEW_KEY_COLUMNS)[number], string>,
): string {
  return BINDING_REVIEW_KEY_COLUMNS.map((c) => row[c]).join('|');
}

export const BINDING_REVIEW_COLUMNS = [
  'tyc', 'hip', 'hd', 'hr', 'gl', 'verdict', 'derived_source_id',
  'derived_via', 'candidates', 'rejected', 'v_mag', 'v_via', 'derived_g',
  'derived_simbad', 'identity_source_id', 'identity_g', 'identity_separation_arcsec',
] as const;
export type BindingReviewRow = Record<Exclude<(typeof BINDING_REVIEW_COLUMNS)[number], 'verdict'>, string> & {
  verdict: BindingReviewVerdict;
};

export const LABEL_DROP_COLUMNS = [...RECORD_KEY_COLUMNS, 'cell', 'value', 'reason'] as const;
export const LABEL_DROP_CELLS = ['hd', 'flam'] as const;
export type LabelDropCell = (typeof LABEL_DROP_CELLS)[number];
/** `value` is the dropped HD or Flamsteed number. */
export interface LabelDropRow extends RecordIdentifiers {
  cell: LabelDropCell;
  value: number;
  reason: LabelDropReason;
}
/** The label-parity reasons (/docs/catalog-driver.md#62-label-parity) a spine label leaves the manifest: no primary publishes
 *  that Flamsteed number, or that HD number, for the star; or the HD is another HIP's (README.md#the-unattested-labels-leave-the-row). */
export const LABEL_DROP_REASONS = ['flamsteed_unattested', 'hd_unattested', 'hd_other_hip'] as const;
export type LabelDropReason = (typeof LABEL_DROP_REASONS)[number];

export const MERGE_DIVERGENCE_COLUMNS = [...RECORD_KEY_COLUMNS, 'divergence', 'cells', 'derived', 'evidence'] as const;
export const MERGE_DIVERGENCE_KINDS = ['unlinked', 'pair_moves', 'derived_only', 'differs'] as const;
export type MergeDivergenceKind = (typeof MERGE_DIVERGENCE_KINDS)[number];
/** see merge-derivation/README.md#the-divergence-ledger */
export interface MergeDivergenceRow extends RecordIdentifiers {
  divergence: MergeDivergenceKind;
  cells: string;
  derived: string;
  evidence: string;
}

/** Why the pair rule names no owner for a HIP two Tycho-2 entries carry. */
export const PAIR_REVIEW_REASONS = [
  'unwitnessed', 'no_entry_matches', 'several_match', 'gate_refused', 'simbad_refused',
] as const;
export type PairReviewReason = (typeof PAIR_REVIEW_REASONS)[number];

export const PAIR_REVIEW_COLUMNS = [...RECORD_KEY_COLUMNS, 'entries', 'reason'] as const;
/** see merge-derivation/README.md#the-pair-review-queue */
export interface PairReviewRow extends RecordIdentifiers {
  entries: readonly string[];
  reason: PairReviewReason;
}

/** How the row's `gaia_source_id` is justified: README.md#columns. */
export const BINDING_CLASSES = [
  'crosswalk_gated', 'simbad_corroborated', 'reviewed', 'position_witnessed', 'gaia_native', 'none',
] as const;
export type BindingClass = (typeof BINDING_CLASSES)[number];
