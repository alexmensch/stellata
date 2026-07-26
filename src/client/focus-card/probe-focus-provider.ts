// Probe provider for the tier-2 focus card — camera-frame distance plus
// the mission stats. See ./README.md § Frame-of-reference principle.

import { fmtDistAuto } from '../ui/distance-util';
import {
  formatProbeLaunch,
  formatProbeSignal,
  formatProbeSpeed,
  formatSolDistance,
} from '../format/probe-format';
import type { ProbeTrajectory } from '../solar-system/probes/probe-trajectory';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

export interface ProbeFocusProviderConfig {
  /** Trajectory for a roster index (ProbeField.probeAt). */
  probeAt: (idx: number) => ProbeTrajectory | null;
  /** Live camera→probe distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number | null;
  /** Live heliocentric distance, pc; null before the first sample. */
  solDistancePc: (idx: number) => number | null;
  /** Live heliocentric speed from the sampler's interpolated velocity,
   *  pc/s; null before the first sample. */
  speedPcPerSec: (idx: number) => number | null;
  /** Whether the model clock has passed this probe's last contact. */
  signalLost: (idx: number) => boolean;
}

export function createProbeFocusProvider(
  config: ProbeFocusProviderConfig,
): FocusCardProvider<'probe'> {
  return {
    kind: 'probe',
    format(idx: number): FocusCardContent {
      const traj = config.probeAt(idx);
      if (!traj) return { name: '', identityLines: [], rows: [], lines: [] };

      const rows: FocusCardRow[] = [
        {
          label: 'Distance',
          value: () => {
            const d = config.cameraDistancePc(idx);
            return d !== null && Number.isFinite(d) ? fmtDistAuto(d) : '—';
          },
        },
        {
          label: 'From Sol',
          value: () => {
            const d = config.solDistancePc(idx);
            return d !== null ? formatSolDistance(d) : '—';
          },
        },
        {
          label: 'Speed',
          value: () => {
            const v = config.speedPcPerSec(idx);
            return v !== null ? formatProbeSpeed(v) : '—';
          },
        },
        { label: 'Launched', value: formatProbeLaunch(traj.launchUtc) },
        // Live because it is a function of the model clock, not of the
        // probe: scrubbing back before last contact restores the signal.
        { label: 'Signal', value: () => formatProbeSignal(config.signalLost(idx), traj.lastContactT) },
      ];

      return {
        name: traj.label,
        identityLines: ['Deep-space probe'],
        rows,
        lines: [traj.mission],
      };
    },
  };
}
