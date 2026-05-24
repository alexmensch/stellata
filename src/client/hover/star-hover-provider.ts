// Star hover provider — picks via `Picker.pickStarHit` and formats via
// `formatStarHover`. See ./README.md.

import type { Stellata } from '../stellata';
import { formatStarHover, type StarHoverFormatContext } from './formatters/star-hover-format';
import type { HoverProvider } from './hover-types';

export interface StarHoverProviderConfig {
  stellata: Stellata;
  context: StarHoverFormatContext;
}

export function createStarHoverProvider(
  config: StarHoverProviderConfig,
): HoverProvider<'star'> {
  const { stellata, context } = config;
  return {
    kind: 'star',
    pick: (x, y, pxThreshold) => stellata.picker.pickStarHit(x, y, pxThreshold),
    // Stars are identified by catalog idx alone — sub-layer host
    // identity (hit.hostStarIdx) is unused for this layer.
    format: (hit) => formatStarHover(hit.idx, context),
  };
}
