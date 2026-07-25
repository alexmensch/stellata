// Planet hover formatter — name, camera distance · Vmag, period,
// radius. See ../README.md § Rule 1a for the line ordering.

import { fmtDistAuto } from '../../ui/distance-util';
import { formatEarthRadii, formatMagnitude } from '../../format/physical-format';
import { moonRosterText } from '../../format/moon-list-format';
import {
  formatOrbitPeriod,
  type OrbitDescriptor,
} from '../../solar-system/ephemerides/orbit-descriptor';
import type { Planet } from '../../solar-system/planet-system';
import type { Target } from '../../camera/focus/focus-target';
import type { SystemMembershipProvider } from '../../system-membership/system-membership';
import { rosterCardOrNull, UNNAMED_MEMBER_LABEL } from './system-card-format';
import type { HoverPayload } from '../hover-types';

// Name budget for the hover roster line — the card stays glanceable;
// the focus card carries the uncapped list.
export const HOVER_MOON_NAME_CAP = 4;

export interface PlanetHoverFormatContext {
  // Planet roster for the focused host. `planetIdx` indexes into this
  // array. Read-only — the formatter never mutates.
  planets: readonly Planet[];
  // Live apparent V mag at the viewer's current position, or null when
  // the planet system isn't attached at format time (degenerate;
  // shouldn't happen because the provider gates on the attached system).
  appMagFor(planetIdx: number): number | null;
  // Parent/orbit descriptor for the body — same source the focus card
  // uses, so the shared Period field can't diverge between tiers (a moon
  // reads its period against its parent planet's mass, in days, not the
  // solar-mass years a planet uses). Null omits the period line.
  orbitOf(planetIdx: number): OrbitDescriptor | null;
  // The body's moon names in semi-major-axis order (empty for moons and
  // moonless bodies) — same source the focus card reads, capped here.
  moonsOf(planetIdx: number): readonly string[];
  // Kind-generic membership queries + the planetIdx → Target mapping.
  // Both present ⇒ a body whose children currently collapse onto it
  // (a planet with sub-pixel moons) swaps to the shared roster card.
  membership?: SystemMembershipProvider;
  targetOf?(planetIdx: number): Target | null;
}

export function formatPlanetHover(
  planetIdx: number,
  cameraDistancePc: number,
  ctx: PlanetHoverFormatContext,
): HoverPayload | null {
  const planet = ctx.planets[planetIdx];
  if (!planet) return null;

  const target = ctx.membership && ctx.targetOf ? ctx.targetOf(planetIdx) : null;
  const system =
    target && ctx.membership
      ? rosterCardOrNull(
          ctx.membership,
          target,
          fmtDistAuto(cameraDistancePc),
          (m) => m.name ?? UNNAMED_MEMBER_LABEL,
        )
      : null;
  if (system) return system;

  const lines: string[] = [];
  const appMag = ctx.appMagFor(planetIdx);
  const magStr = appMag !== null ? `Vmag ${formatMagnitude(appMag)}` : '';
  const headLine = [fmtDistAuto(cameraDistancePc), magStr].filter(Boolean).join(' · ');
  lines.push(headLine);

  // Period above Radius — orbital period is the user's first "is this
  // a fast inner planet or a slow outer one?" tell, and the AU
  // distance on line 2 pairs naturally with the period rather than
  // with the body's physical size.
  const orbit = ctx.orbitOf(planetIdx);
  if (orbit) lines.push(`Period ${formatOrbitPeriod(orbit)}`);
  lines.push(`Radius ${formatEarthRadii(planet.radiusKm)}`);

  // Label-first, no colon — the same shape as the Period/Radius lines.
  const roster = moonRosterText(ctx.moonsOf(planetIdx), HOVER_MOON_NAME_CAP);
  if (roster) lines.push(`Moons ${roster}`);

  return { name: planet.name, lines };
}

