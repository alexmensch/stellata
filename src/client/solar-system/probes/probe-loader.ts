// Fetches the five probe trajectory JSONs from public/probes/ and parses
// each into a runtime ProbeTrajectory. See README.md § Loading.

import { PROBE_MISSIONS } from '../../../../scripts/probes/probe-roster';
import { probeTrajectoryFilename } from '../../../../scripts/probes/sync-probes-pure';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import { buildProbeTrajectory, type ProbeTrajectory } from './probe-trajectory';

/**
 * Load every probe whose artifact is present, in roster order. A missing
 * file is expected data (a checkout that never ran the `public/` sync) and
 * drops that probe rather than failing the load — the scene renders
 * identically minus its marker and trail.
 */
export async function loadProbes(baseUrl: string): Promise<ProbeTrajectory[]> {
  const settled = await Promise.all(
    PROBE_MISSIONS.map(async (mission) => {
      try {
        const res = await fetch(`${baseUrl}probes/${probeTrajectoryFilename(mission.id)}`);
        if (!res.ok) return null;
        return buildProbeTrajectory(await res.json() as ProbeTrajectoryFile);
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((p): p is ProbeTrajectory => p !== null);
}
