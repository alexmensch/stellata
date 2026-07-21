// Per-cloud silhouette-hugging SVG name labels — the Local Bubble label
// pattern applied per cloud via the shared shell-label engine.

import type { Stellata } from '../stellata';
import { createShellSilhouetteLabel } from '../fresnel-shell/fresnel-shell';

/** Container `<g>` in index.html the per-cloud `<text>` nodes mint into. */
export const CLOUD_LABELS_GROUP_ID = 'cloud-labels';

// A label only shows once the cloud's silhouette is large enough on
// screen to be the thing the user is looking at — the cloud-family
// analogue of the heliopause label's orbit-ring heuristic and the LG
// labels' distance thresholds (every 'all'-tier label carries its own
// relevance gate on top of the declutter floor).
const LABEL_MIN_SILHOUETTE_PX = 40;

/** Mount one silhouette-hugging label per cloud. Call once after
 *  `attachClouds`; labels for a later replaced layer hide via the
 *  layer-identity check in the visibility predicate. */
export function createMolecularCloudLabels(stellata: Stellata): void {
  const clouds = stellata.cloudLayer;
  const group = document.getElementById(CLOUD_LABELS_GROUP_ID);
  if (!clouds || !group) return;
  clouds.clouds.forEach((cloud, idx) => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.id = `cloud-label-${idx}`;
    text.setAttribute('class', 'heliopause-label');
    text.setAttribute('text-anchor', 'start');
    text.setAttribute('dominant-baseline', 'hanging');
    text.textContent = cloud.name;
    group.appendChild(text);
    createShellSilhouetteLabel(stellata, {
      elementId: text.id,
      sampleCount: clouds.labelSampleCount(idx),
      getWorldSample: (i, out) =>
        clouds.labelSampleInto(idx, i, stellata.getWorldOffset(), out),
      visible: () =>
        stellata.cloudLayer === clouds
        && !stellata.getMonochrome()
        && stellata.detailPermits('molecularCloudLabels')
        && stellata.renderedCloudSizePx(idx) >= LABEL_MIN_SILHOUETTE_PX,
    });
  });
}
