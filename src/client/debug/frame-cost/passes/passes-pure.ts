// The priced-pass roster: every row key a priceFrame table can carry, and
// the emptyPass row's default count. See README.md.

/** The one row whose meaning moves with a knob rather than with the frame:
 *  `--empty-passes` sets how many clears it adds, so two runs at different
 *  counts price different numbers of pass boundaries under one key. */
export const EMPTY_PASS_KEY = 'emptyPass';

/** Every row `buildPassToggles` can produce, in table order. Lives here
 *  rather than with the toggles so a caller can check a requested key
 *  without pulling the renderer in: an unrecognised key would otherwise
 *  filter the roster to empty and read as the sweep being refused. */
export const PRICED_PASS_KEYS = [
  'localDepth', 'mwBand', 'lgEmission', 'cloudAbsorption', 'hdrChain',
  'tonemapOp', 'statisticWrites', 'summation', 'summationTaps', 'mrtAttachments',
  'reduction', 'coreMask', 'planetDepthStamp', 'extinctionPrepass', EMPTY_PASS_KEY,
] as const;

export type PricedPassKey = (typeof PRICED_PASS_KEYS)[number];

/** Empty render passes the `emptyPass` row adds while "disabled" wherever
 *  the caller names no count. One is often under `bracketMs` and the row
 *  then does not resolve — README.md § The roster. */
export const EMPTY_PASSES_DEFAULT = 1;
