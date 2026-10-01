// Test-only: real share links whose decoding is pinned.

/** The first-load view as chosen, shared before bit 29 existed: Earth, orb +
 *  orbLock, cam and up in ICRS as they stood at `CHOSEN_FIRST_LOAD_AT`. */
export const CHOSEN_FIRST_LOAD_LINK = 'BIXAgcABB-kUFDT_dEk0ndYxNAckT-C-k7vIvpsVTz8C-v8T';
export const CHOSEN_FIRST_LOAD_AT = Date.UTC(2026, 8, 30, 10, 13) / 1000;

/** The homepage's observe and chart-mode sights, as first captured and as
 *  re-captured: OBSERVE on Sol with `cam` elided, each pair differing only in `up`. */
export const SOL_OBSERVE_LINKS = {
  observe: 'BIbEgCEHhy39Pe3mW7_EYf6-ByIrBD9jar6-331FP0whLA5d0xcU20E',
  observeRecaptured: 'BIbEgCEHhy39Pe3mW7_EYf6-B1MYsD38ovq-MiReP0whLA5d0xcU20E',
  chart: 'BIbEgCEHWWDcPaFXfj_yXhW9B5GuFj9Drwu9sMVOPzthLA5d0xcU20E',
  chartRecaptured: 'BIbEgCEHWWDcPaFXfj_yXhW9ByKUzz76uim8aABqPzthLA5d0xcU20E',
} as const;
