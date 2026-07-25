// Allowlist predicate for data/probes/ → public/probes/ mirroring: only
// the five roster trajectory JSONs ship; the folder README must not.

import { PROBE_MISSIONS } from './probe-roster';

export function probeTrajectoryFilename(id: string): string {
  return `${id}.json`;
}

const ALLOWED = new Set(PROBE_MISSIONS.map((p) => probeTrajectoryFilename(p.id)));

export function isProbePublicAsset(name: string): boolean {
  return ALLOWED.has(name);
}
