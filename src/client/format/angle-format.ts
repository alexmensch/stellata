// Whole-degree longitude label, shared by the coordinate-sphere grid and the
// card tiers. See ./README.md.

import { pyMod } from '../../astro-core/angles';

/** Whole degrees, wrapped to [0, 360). Rounds before wrapping, so 359.6 reads 0°. */
export function fmtLonDeg(deg: number): string {
  return `${pyMod(Math.round(deg), 360)}°`;
}
