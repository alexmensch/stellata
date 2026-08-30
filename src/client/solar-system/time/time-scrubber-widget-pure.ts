// Pure helper: format a clock rate (sim-seconds per real second) as a human
// "time / second" phrase for the scrubber-widget readout.
// See ./README.md § Time scrubber widget.

interface RateUnit {
  /** Seconds this unit spans. */
  sec: number;
  /** Label when the rounded value is exactly 1. */
  one: string;
  /** Label for any other value. */
  many: string;
  /** Glue the label to the number with no space ("2s" vs "2 min"). */
  glue?: boolean;
}

// Ascending; the largest unit the rate reaches wins. Month = 365.25/12 days,
// year = 365.25 days, so decade/century/millennium chain cleanly off it.
const RATE_UNITS: readonly RateUnit[] = [
  { sec: 1, one: 's', many: 's', glue: true },
  { sec: 60, one: 'min', many: 'min' },
  { sec: 3600, one: 'hr', many: 'hr' },
  { sec: 86400, one: 'day', many: 'days' },
  { sec: 604800, one: 'week', many: 'weeks' },
  { sec: 2629800, one: 'month', many: 'months' },
  { sec: 31557600, one: 'yr', many: 'yr' },
  { sec: 315576000, one: 'decade', many: 'decades' },
  { sec: 3155760000, one: 'century', many: 'centuries' },
  { sec: 31557600000, one: 'millennium', many: 'millennia' },
];

/**
 * Format a clock rate as "<value> <unit> / second", picking the largest unit
 * the rate reaches (60 → "1 min / second", 86400 → "1 day / second"). Values
 * ≥ 10 round to an integer, smaller ones keep one decimal so power-of-two
 * rates read cleanly ("2s", "1.1 min"). Rate 0 is "paused"; negative (rewind)
 * rates carry a leading minus.
 */
export function formatRatePerSecond(rate: number): string {
  if (rate === 0) return 'paused';
  const mag = Math.abs(rate);
  let unit = RATE_UNITS[0];
  for (const u of RATE_UNITS) {
    if (mag >= u.sec) unit = u;
    else break;
  }
  const value = mag / unit.sec;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  const sign = rate < 0 ? '−' : '';
  const label = rounded === 1 ? unit.one : unit.many;
  const body = unit.glue ? `${sign}${rounded}${label}` : `${sign}${rounded} ${label}`;
  return `${body} / second`;
}
