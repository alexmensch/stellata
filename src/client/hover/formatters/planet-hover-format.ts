// Planet hover formatter — name, camera distance · Vmag, period,
// radius. See ../README.md § Rule 1a for the line ordering.

import { fmtDistAuto } from '../../ui/distance-util';
import {
  formatEarthRadii,
  formatMagnitude,
  formatPeriodYears,
  planetPeriodYears,
} from '../../format/physical-format';
import type { Planet } from '../../solar-system/planet-system';
import type { HoverPayload } from '../hover-types';

export interface PlanetHoverFormatContext {
  // Planet roster for the focused host. `planetIdx` indexes into this
  // array. Read-only — the formatter never mutates.
  planets: readonly Planet[];
  // Live apparent V mag at the viewer's current position, or null when
  // the planet system isn't attached at format time (degenerate;
  // shouldn't happen because the provider gates on the attached system).
  appMagFor(planetIdx: number): number | null;
}

export function formatPlanetHover(
  planetIdx: number,
  cameraDistancePc: number,
  ctx: PlanetHoverFormatContext,
): HoverPayload {
  const planet = ctx.planets[planetIdx];
  if (!planet) return { name: '', lines: [] };

  const lines: string[] = [];
  const appMag = ctx.appMagFor(planetIdx);
  const magStr = appMag !== null ? `Vmag ${formatMagnitude(appMag)}` : '';
  const headLine = [fmtDistAuto(cameraDistancePc), magStr].filter(Boolean).join(' · ');
  lines.push(headLine);

  // Period above Radius — orbital period is the user's first "is this
  // a fast inner planet or a slow outer one?" tell, and the AU
  // distance on line 2 pairs naturally with the period rather than
  // with the body's physical size.
  lines.push(`Period ${formatPeriodYears(planetPeriodYears(planet.semiMajorAxisAu))} yr`);
  lines.push(`Radius ${formatEarthRadii(planet.radiusKm)}`);

  return { name: planet.name, lines };
}
