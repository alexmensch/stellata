// UTC timestamp readout for the current `t`. See
// src/client/solar-system/README.md § Time.

import type { Stellata } from '../../stellata';


const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Format a Unix-seconds value as `D MMM YYYY, HH:MM:SS UTC` (e.g.
 *  `7 May 2026, 18:23:45 UTC`). Locale-independent so the output is
 *  identical across browsers — month names use the en-US short form
 *  the user picked over numeric date order to avoid DD/MM vs MM/DD
 *  ambiguity. The `UTC` suffix removes any timezone confusion. */
export function formatTimeReadout(t: number): string {
  const d = new Date(t * 1000);
  const day = d.getUTCDate();
  const mon = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm}:${ss} UTC`;
}

export interface TimeReadoutDeps {
  el: HTMLElement;
  stellata: Stellata;
}

/** Mount a live UTC readout into `el`: unhide it and tick
 *  `Stellata.getT()` once per second. Orbital evolution ticks against
 *  `getT()` in every mode (chart, warp, observe, free fly), so the current
 *  model time is worth showing throughout. Returns a teardown that stops
 *  the tick — callers swap the readout in and out (the scrubber widget
 *  stops this collapsed readout while it's expanded and shows its own),
 *  and tests / HMR dispose it. */
export function createTimeReadout({ el, stellata }: TimeReadoutDeps): () => void {
  const tick = () => {
    el.textContent = formatTimeReadout(stellata.getT());
  };
  el.hidden = false;
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
