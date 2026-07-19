// Planet hover formatter — name, camera distance · Vmag, period,
// radius. See ../README.md § Rule 1a for the line ordering.

import { fmtDistAuto } from '../../ui/distance-util';
import { formatEarthRadii, formatMagnitude } from '../../format/physical-format';
import { moonRosterText } from '../../format/moon-list-format';
import {
  formatOrbitPeriod,
  type OrbitDescriptor,
} from '../../solar-system/orbit-descriptor';
import type { Planet } from '../../solar-system/planet-system';
import type { Target } from '../../camera/focus/focus-target';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../../system-membership/system-membership';
import { systemCard, UNNAMED_MEMBER_LABEL } from './system-card-format';
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
): HoverPayload {
  const planet = ctx.planets[planetIdx];
  if (!planet) return { name: '', lines: [] };

  const system = systemCardOrNull(planetIdx, cameraDistancePc, ctx);
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

/** Roster swap for a hovered body whose own collapsed cluster (its
 *  sub-pixel moons) has 2+ members — the moon-planet analogue of the
 *  star card's multi-star swap. The hovered body itself was picked, so
 *  it is resolvable; the cluster never reaches the host star. */
function systemCardOrNull(
  planetIdx: number,
  cameraDistancePc: number,
  ctx: PlanetHoverFormatContext,
): HoverPayload | null {
  if (!ctx.membership || !ctx.targetOf) return null;
  const target = ctx.targetOf(planetIdx);
  if (!target) return null;
  const cluster = ctx.membership.collapsedClusterOf(target);
  if (cluster.length < 2) return null;
  const members = ctx.membership.membersOf(target);
  if (members.length < 3) return null;
  const label = (m: SystemMember) => m.name ?? UNNAMED_MEMBER_LABEL;
  return systemCard(
    label(cluster[0]),
    fmtDistAuto(cameraDistancePc),
    members.length,
    cluster.map(label),
  );
}
