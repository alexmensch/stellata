// Shared helpers for the hover-card formatters (axis-pair stringifier,
// unit-aware distance). See ./README.md.

import { fmtDist } from '../../ui/distance-util';

/**
 * Render a major × minor axis pair as "<major> × <minor> <unit>". Both
 * values run through `fmtDist` so the user-selected pc/ly unit and the
 * decade-tier prefix (k, M) apply; the major's trailing " pc" / " ly"
 * is stripped so the unit suffix appears once at the end. Local Group
 * semi-axes (~50 pc — ~30 kpc) and cloud semi-axes (~5 pc — ~90 pc)
 * both land in the same `fmtDist` decade tier in practice, so the
 * single suffix reads consistently.
 */
export function formatAxisPair(majorPc: number, minorPc: number): string {
  const minor = fmtDist(minorPc);
  const major = fmtDist(majorPc).replace(/\s+(pc|ly)$/, '');
  return `${major} × ${minor}`;
}
