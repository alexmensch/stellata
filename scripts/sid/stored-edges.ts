// The stored same-as edges: the curated overrides plus every cross-release bridge (/docs/sid.md#41-same-as-equivalence-graph).

import { SAMEAS_BRIDGES, SAMEAS_OVERRIDES } from './sameas-source';
import type { SameasEdge } from './sid-pure';

export function loadStoredEdges(): SameasEdge[] {
  return [...SAMEAS_OVERRIDES.read(), ...SAMEAS_BRIDGES.read()];
}
