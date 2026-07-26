// Probe hover provider — picks across the loaded probe roster. See
// ./README.md.

import type { Stellata } from '../stellata';
import { formatProbeHover } from './formatters/probe-hover-format';
import type { HoverProvider } from './hover-types';

export interface ProbeHoverProviderConfig {
  stellata: Stellata;
}

export function createProbeHoverProvider(
  config: ProbeHoverProviderConfig,
): HoverProvider<'probe'> {
  const { stellata } = config;
  return {
    kind: 'probe',
    pick: (x, y, pxThreshold) => stellata.picker.pickProbeHit(x, y, pxThreshold),
    format: (hit) => {
      const traj = stellata.probeField.probeAt(hit.idx);
      const sample = stellata.probeField.sampleFor(hit.idx);
      if (!traj || sample === null || !sample.sampled) return null;
      return formatProbeHover({
        label: traj.label,
        cameraDistancePc: hit.cameraDistancePc,
        solDistancePc: sample.solRelPc.length(),
        speedPcPerSec: sample.velPcPerSec.length(),
        signalLost: sample.signalLost,
        lastContactT: traj.lastContactT,
      });
    },
  };
}
