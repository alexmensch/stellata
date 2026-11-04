// Allowlist predicate for data/probes/ → public/probes/ mirroring: only
// the five roster trajectory JSONs ship; the folder README must not.

import { rosterFileName } from '../public-artifacts/public-artifacts';
import { PROBE_MISSIONS } from './probe-roster';

const ALLOWED = new Set(PROBE_MISSIONS.map((p) => rosterFileName(p.id)));

export function isProbePublicAsset(name: string): boolean {
  return ALLOWED.has(name);
}
