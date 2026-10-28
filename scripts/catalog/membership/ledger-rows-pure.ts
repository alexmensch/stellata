// The three membership ledgers' row shapes. See README.md#files-in-this-area.

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

export const LEDGER_COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const;
export type AdditionLedgerRow = Record<(typeof LEDGER_COLUMNS)[number], string>;

export const BINDING_REVIEW_VERDICTS = ['contested', 'collision', 'disposed'] as const;
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
  'derived_simbad',
] as const;
export type BindingReviewRow = Record<(typeof BINDING_REVIEW_COLUMNS)[number], string>;

export const LABEL_DROP_COLUMNS = [
  'tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'cell', 'value', 'reason',
] as const;
export type LabelDropRow = Record<(typeof LABEL_DROP_COLUMNS)[number], string>;
/** The label-parity reasons (/docs/catalog-driver.md#62-label-parity) a spine label leaves the manifest: no primary publishes
 *  that Flamsteed number, or that HD number, for the star. */
export const LABEL_DROP_REASONS = ['flamsteed_unattested', 'hd_unattested'] as const;
export type LabelDropReason = (typeof LABEL_DROP_REASONS)[number];
