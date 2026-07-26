// Deep-space-probe hover formatter — camera-frame distance, then the
// mission stats the focus card shows. See ./README.md.

import { fmtDistAuto } from '../../ui/distance-util';
import {
  formatProbeSignal,
  formatProbeSpeed,
  formatSolDistance,
} from '../../format/probe-format';
import type { HoverPayload } from '../hover-types';

export interface ProbeHoverFormatContext {
  label: string;
  cameraDistancePc: number;
  solDistancePc: number;
  speedPcPerSec: number;
  signalLost: boolean;
  lastContactT: number | null;
}

/**
 * A probe carries no magnitude, so the camera-relative first line stands
 * alone rather than pairing with a Vmag as the planet card's does. The
 * signal line appears only once the clock has passed last contact — for a
 * live probe "Signal Active" is noise on a card capped at ~5 lines.
 */
export function formatProbeHover(ctx: ProbeHoverFormatContext): HoverPayload {
  const lines = [
    fmtDistAuto(ctx.cameraDistancePc),
    `From Sol ${formatSolDistance(ctx.solDistancePc)}`,
    `Speed ${formatProbeSpeed(ctx.speedPcPerSec)}`,
  ];
  if (ctx.signalLost) {
    lines.push(`Signal ${formatProbeSignal(true, ctx.lastContactT)}`);
  }
  return { name: ctx.label, lines };
}
