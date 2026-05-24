// Molecular cloud hover provider — fallback-tier raycast against the
// ellipsoid meshes. See ./README.md for the engine contract and UX
// rules this provider follows.

import type { Stellata } from '../stellata';
import {
  formatCloudHover,
  type CloudHoverFormatContext,
} from './formatters/cloud-hover-format';
import type { HoverProvider } from './hover-types';

export interface CloudHoverProviderConfig {
  stellata: Stellata;
  context: CloudHoverFormatContext;
}

export function createCloudHoverProvider(
  config: CloudHoverProviderConfig,
): HoverProvider<'cloud'> {
  const { stellata, context } = config;
  return {
    kind: 'cloud',
    pick: (x, y, pxThreshold) => stellata.picker.pickCloudHit(x, y, pxThreshold),
    // Cloud objects are identified by catalog idx alone — sub-layer
    // host identity (hit.hostStarIdx) is unused for this layer.
    format: (hit) => formatCloudHover(hit.idx, context),
  };
}
