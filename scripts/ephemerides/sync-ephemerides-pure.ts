// Allowlist predicate for data/ephemerides/ → public/ephemerides/ mirroring:
// only the nine roster element tables ship; the folder README must not.

import { ELEMENT_TARGETS } from './planet-element-roster';

export function planetElementFilename(id: string): string {
  return `${id}.json`;
}

const ALLOWED = new Set(ELEMENT_TARGETS.map((t) => planetElementFilename(t.id)));

export function isPlanetElementPublicAsset(name: string): boolean {
  return ALLOWED.has(name);
}
