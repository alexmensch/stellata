// Local Group hover provider — picks against the wireframe layer.
// See ./README.md.

import type { Stellata } from '../stellata';
import {
  formatLocalGroupHover,
  type LocalGroupHoverFormatContext,
} from './formatters/local-group-hover-format';
import type { HoverProvider } from './hover-types';

export interface LocalGroupHoverProviderConfig {
  stellata: Stellata;
  context: LocalGroupHoverFormatContext;
}

export function createLocalGroupHoverProvider(
  config: LocalGroupHoverProviderConfig,
): HoverProvider<'local-group'> {
  const { stellata, context } = config;
  return {
    kind: 'local-group',
    pick: (x, y, pxThreshold) => stellata.picker.pickLocalGroupHit(x, y, pxThreshold),
    // LG objects are identified by catalog idx alone — sub-layer host
    // identity (hit.hostStarIdx) is unused for this layer.
    format: (hit) => formatLocalGroupHover(hit.idx, hit.cameraDistancePc, context),
  };
}
