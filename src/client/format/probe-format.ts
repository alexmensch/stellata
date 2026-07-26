// Deep-space-probe mission stats shared by the hover and focus cards.
// See ./README.md.

import { AU_PER_PC, KM_PC, LIGHT_TIME_PER_AU_S } from '../util/astronomy-constants';

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
  const lightHours = (au * LIGHT_TIME_PER_AU_S) / SECONDS_PER_HOUR;
  return `${au.toFixed(1)} AU (${lightHours.toFixed(1)} lt-hr)`;
}

/** Heliocentric speed from the sampler's interpolated velocity (pc/s):
 *  "17.02 km/s". */
export function formatProbeSpeed(speedPcPerSec: number): string {
  return `${(speedPcPerSec / KM_PC).toFixed(2)} km/s`;
}

/**
 * Date rendering for the probe card fields — ISO year and day with the
 * month as a 3-letter name: "1977-Aug-20". A numeric month is ambiguous
 * (an American reader takes 08-20 day-last, a European reader day-first),
 * and a mission date the user can misread by ten months is worse than no
 * date. The name removes the ambiguity in every convention.
 *
 * The order lives in `PROBE_DATE_FORMAT` and the part values come from
 * `Intl`, so neither the field order nor the month names are spelled out
 * at a call site. The locale is **pinned**: this is a fixed rendering,
 * not a localised one — leaving it to the environment would make the
 * output vary by runner (the `formatThousands` lesson in
 * `physical-format.ts`).
 */
const PROBE_DATE_FORMAT = '{year}-{month}-{day}';
const PROBE_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit',
});

function formatProbeDate(unixSeconds: number): string {
  const parts = new Map<string, string>(
    PROBE_DATE_PARTS.formatToParts(new Date(unixSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  return PROBE_DATE_FORMAT.replace(/\{(\w+)\}/g, (_, key: string) => parts.get(key) ?? '');
}

/** Launch date from the roster's ISO-8601 launch instant. */
export function formatProbeLaunch(launchUtc: string): string {
  return formatProbeDate(Date.parse(launchUtc) / 1000);
}

/** Signal state at the model clock: "Active", or the last-contact date
 *  once `t` has passed it. `lastContactT` is null while the probe still
 *  transmits, so a still-live probe never reads as lost. */
export function formatProbeSignal(signalLost: boolean, lastContactT: number | null): string {
  if (!signalLost || lastContactT === null) return 'Active';
  return `Lost ${formatProbeDate(lastContactT)}`;
}
