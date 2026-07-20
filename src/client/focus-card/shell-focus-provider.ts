// Boundary-shell provider for the tier-2 focus card. See ./README.md.

import type { ShellInstance } from '../fresnel-shell/shell-registry';
import { fmtDistAuto } from '../ui/distance-util';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

export interface ShellFocusProviderConfig {
  /** The shell at a `Target.idx`, or null when its layer isn't loaded. */
  shellAt: (idx: number) => ShellInstance | null;
  /** Live camera→center distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number;
}

export function createShellFocusProvider(
  config: ShellFocusProviderConfig,
): FocusCardProvider<'shell'> {
  return {
    kind: 'shell',
    format(idx: number): FocusCardContent {
      const shell = config.shellAt(idx);
      if (!shell) return { name: '', identityLines: [], rows: [], lines: [] };
      const rows: FocusCardRow[] = [
        { label: 'Distance', value: () => fmtDistAuto(config.cameraDistancePc(idx)) },
        { label: 'Size', value: shell.card.size },
        { label: 'Known from', value: shell.card.knownFrom },
      ];
      return { name: shell.label, identityLines: [shell.card.typeLine], rows, lines: [] };
    },
  };
}
