// Star hover provider — picks via `Picker.pickStarHit` and formats via
// `formatStarHover`. See ./README.md.

import type { Stellata } from '../stellata';
import { tToJDE } from '../solar-system/time';
import { formatStarHover, type StarHoverFormatContext } from './formatters/star-hover-format';
import type { HoverProvider } from './hover-types';

export interface StarHoverProviderConfig {
  stellata: Stellata;
  // Everything the formatter needs except the live sim time and the
  // membership queries, which the provider wires from Stellata itself.
  context: Omit<StarHoverFormatContext, 'nowJd' | 'membership'>;
}

export function createStarHoverProvider(
  config: StarHoverProviderConfig,
): HoverProvider<'star'> {
  const { stellata, context } = config;
  return {
    kind: 'star',
    pick: (x, y, pxThreshold) => stellata.picker.pickStarHit(x, y, pxThreshold),
    // Stars are identified by catalog idx alone; the binary role is
    // derived from `context.binaries` in the formatter. `nowJd` is
    // sampled fresh so the Tier-1 live separation tracks the sim clock.
    format: (hit) =>
      formatStarHover(hit.idx, hit.cameraDistancePc, {
        ...context,
        nowJd: tToJDE(stellata.getT()),
        membership: stellata.systemMembership,
      }),
  };
}
