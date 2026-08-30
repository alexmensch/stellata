// Two-line time readout for the current `t`: UT date line + JD(TT)/ΔT
// line. See ./README.md § Time `t` and the readout.

import type { Stellata } from '../../stellata';
import { tToJdUt } from './time';
import { deltaTSeconds } from './delta-t-pure';


const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Format a Unix-seconds value as `D MMM YYYY, HH:MM:SS UT`, with a
 *  ` (Gregorian)` suffix when `showCalendar` is set (the collapsed
 *  readout; the expanded scrubber has no room for it). Locale-independent
 *  so the output is identical across browsers — month names use the en-US
 *  short form the user picked over numeric date order to avoid DD/MM vs
 *  MM/DD ambiguity. Both suffixes are load-bearing: the model's day count
 *  is UT (leap-second-free; UTC did not exist before 1972), and the
 *  calendar stays proleptic Gregorian in every era while the eclipse
 *  canons label pre-1582 events in the Julian calendar — 18 days apart at
 *  2000 BC. */
export function formatTimeReadout(t: number, showCalendar = false): string {
  const d = new Date(t * 1000);
  const day = d.getUTCDate();
  const mon = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const calendar = showCalendar ? ' (Gregorian)' : '';
  return `${day} ${mon} ${year}, ${hh}:${mm}:${ss} UT${calendar}`;
}

/** ΔT as a signed human offset: `+12h 54m`, `+1m 4s`, `-3s`. Rounds
 *  before branching so a value at a unit boundary rolls up (`+1m 0s`,
 *  `+1h 0m`) instead of printing `+60s` / `+60m`. */
export function formatDeltaT(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const s = Math.round(Math.abs(seconds));
  if (s >= 3600) {
    const m = Math.round(Math.abs(seconds) / 60);
    return `${sign}${Math.floor(m / 60)}h ${m % 60}m`;
  }
  if (s >= 60) return `${sign}${Math.floor(s / 60)}m ${s % 60}s`;
  return `${sign}${s}s`;
}

/** The readout's second line: `JD 991085.635000 TT · ΔT +12h 54m`. TT
 *  because that is the scale every eclipse canon publishes JD against, so
 *  the number is directly matchable — and a bare `JD` is ambiguous. Six
 *  decimals (0.086 s) so it agrees with the date line at the seconds
 *  resolution displayed. The two lines legitimately name different
 *  calendar days — the JD is ΔT later than the UT line, which is exactly
 *  the reconciliation this line exists to expose. */
export function formatJdReadout(t: number): string {
  const jdUt = tToJdUt(t);
  const dT = deltaTSeconds(jdUt);
  return `JD ${(jdUt + dT / 86400).toFixed(6)} TT · ΔT ${formatDeltaT(dT)}`;
}

/** Both readout lines, `\n`-joined — rendered by `white-space: pre-line`
 *  on `.time-readout`. `showCalendar` follows the date line's rule. */
export function formatFullTimeReadout(t: number, showCalendar = false): string {
  return `${formatTimeReadout(t, showCalendar)}\n${formatJdReadout(t)}`;
}

export interface TimeReadoutDeps {
  el: HTMLElement;
  stellata: Stellata;
}

/** Mount a live time readout into `el`: unhide it and tick
 *  `Stellata.getT()` once per second. Orbital evolution ticks against
 *  `getT()` in every mode (chart, warp, observe, free fly), so the current
 *  model time is worth showing throughout. Returns a teardown that stops
 *  the tick — callers swap the readout in and out (the scrubber widget
 *  stops this collapsed readout while it's expanded and shows its own),
 *  and tests / HMR dispose it. */
export function createTimeReadout({ el, stellata }: TimeReadoutDeps): () => void {
  const tick = () => {
    el.textContent = formatFullTimeReadout(stellata.getT(), true);
  };
  el.hidden = false;
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
