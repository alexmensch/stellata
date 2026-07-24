// Boundary-shell hover provider — fallback-tier silhouette / label picks
// over the shell registry. See ./README.md.

import type { Stellata } from '../stellata';
import { formatShellHover } from './formatters/shell-hover-format';
import type { HoverPayload, HoverProvider } from './hover-types';

export interface ShellHoverProviderConfig {
  stellata: Stellata;
}

export function createShellHoverProvider(
  config: ShellHoverProviderConfig,
): HoverProvider<'shell'> {
  const { stellata } = config;
  return {
    kind: 'shell',
    pick: (x, y, pxThreshold) => stellata.picker.pickShellHit(x, y, pxThreshold),
    format: (hit): HoverPayload | null => {
      const shell = stellata.shells.at(hit.idx);
      if (!shell) return null;
      return formatShellHover(shell, hit.cameraDistancePc);
    },
  };
}
