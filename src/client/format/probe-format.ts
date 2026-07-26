// Deep-space-probe mission stats shared by the hover and focus cards.
// See ./README.md.

import { AU_PER_PC, KM_PC } from '../util/astronomy-constants';

/** Speed of light, km/s (exact by the SI definition of the metre). */
const C_KM_S = 299_792.458;
const SECONDS_PER_HOUR = 3600;

/**
 * Heliocentric distance as a mission stat: "165.3 AU (22.9 lt-hr)". AU is
 * the scale these missions are reported in; the light-time pair is what
 * makes the number mean something — it is how long a command takes to
 * reach the spacecraft.
 *
 * Deliberately Sol-relative, unlike every other card distance: it is an
 * intrinsic property of how far the mission has got, not a camera-frame
 * measurement. Both card tiers label it "From Sol" so it can't be read as
 * the camera-relative Distance row beside it.
 */
export function formatSolDistance(distPc: number): string {
  const au = distPc * AU_PER_PC;
  const lightHours = distPc / KM_PC / C_KM_S / SECONDS_PER_HOUR;
  return `${au.toFixed(1)} AU (${lightHours.toFixed(1)} lt-hr)`;
}

/** Heliocentric speed from the sampler's interpolated velocity (pc/s):
 *  "17.02 km/s". */
export function formatProbeSpeed(speedPcPerSec: number): string {
  return `${(speedPcPerSec / KM_PC).toFixed(2)} km/s`;
}

/** UTC calendar date of a model-time epoch in seconds — the one date
 *  convention both probe date fields render through. */
function utcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Launch date from the roster's ISO-8601 launch instant: "1977-09-05". */
export function formatProbeLaunch(launchUtc: string): string {
  return launchUtc.slice(0, 10);
}

/** Signal state at the model clock: "Active", or the last-contact date
 *  once `t` has passed it. `lastContactT` is null while the probe still
 *  transmits, so a still-live probe never reads as lost. */
export function formatProbeSignal(signalLost: boolean, lastContactT: number | null): string {
  if (!signalLost || lastContactT === null) return 'Active';
  return `Lost ${utcDate(lastContactT)}`;
}
