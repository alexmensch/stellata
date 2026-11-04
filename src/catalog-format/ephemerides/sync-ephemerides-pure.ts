// Allowlist predicate for data/ephemerides/ → public/ephemerides/ mirroring:
// only the nine roster element tables ship; the folder README must not.

import { rosterFileName } from '../public-artifacts/public-artifacts';
import { ELEMENT_TARGETS } from './planet-element-roster';

const ALLOWED = new Set(ELEMENT_TARGETS.map((t) => rosterFileName(t.id)));

export function isPlanetElementPublicAsset(name: string): boolean {
  return ALLOWED.has(name);
}
