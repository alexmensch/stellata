// Boundary-shell hover formatter — display name, camera-frame distance,
// type descriptor, size. See ./README.md.

import { fmtDistAuto } from '../../ui/distance-util';
import type { ShellInstance } from '../../fresnel-shell/shell-registry';
import type { HoverPayload } from '../hover-types';

export function formatShellHover(shell: ShellInstance, cameraDistancePc: number): HoverPayload {
  const sizeLines = typeof shell.card.size === 'string'
    ? [`Size ${shell.card.size}`]
    : shell.card.size.map((m) => `${m.value} ${m.label.toLowerCase()}`);
  return {
    name: shell.label,
    lines: [fmtDistAuto(cameraDistancePc), shell.card.typeLine, ...sizeLines],
  };
}
