// Heliopause apex hover provider — fallback-tier picks against the
// labelled apex marker. See ./README.md.

import type { Stellata } from '../stellata';
import { formatHeliopauseHover } from './formatters/heliopause-hover-format';
import type { HoverProvider } from './hover-types';

export interface HeliopauseHoverProviderConfig {
  stellata: Stellata;
}

export function createHeliopauseHoverProvider(
  config: HeliopauseHoverProviderConfig,
): HoverProvider<'heliopause'> {
  const { stellata } = config;
  return {
    kind: 'heliopause',
    pick: (x, y, pxThreshold) => stellata.picker.pickHeliopauseHit(x, y, pxThreshold),
    // The apex is the lone object on this layer — no idx decoding,
    // no sub-layer identity. Format is keyed off the constant payload.
    format: () => formatHeliopauseHover(),
  };
}
