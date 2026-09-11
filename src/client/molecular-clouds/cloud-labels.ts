// Per-cloud silhouette-hugging SVG name labels — the Local Bubble label
// pattern applied per cloud via the shared shell-label engine.

import type { KindContext } from '../kinds/kind-module';
import { createShellSilhouetteLabel } from '../fresnel-shell/fresnel-shell';
import type { MolecularClouds } from './molecular-clouds';

/** Container `<g>` in index.html the per-cloud `<text>` nodes mint into. */
export const CLOUD_LABELS_GROUP_ID = 'cloud-labels';

// A label only shows once the cloud's silhouette is large enough on
// screen to be the thing the user is looking at — the cloud-family
// analogue of the heliopause label's orbit-ring heuristic and the LG
// labels' distance thresholds (every 'all'-tier label carries its own
// relevance gate on top of the declutter floor).
const LABEL_MIN_SILHOUETTE_PX = 40;

/** Mount one silhouette-hugging label per cloud. Called from the cloud
 *  module's `labels()` leg after attach; the returned teardown removes
 *  the minted nodes and detaches every frame handler. */
export function createMolecularCloudLabels(
  ctx: KindContext,
  clouds: MolecularClouds,
  renderedSizePx: (idx: number) => number,
): () => void {
  const group = document.getElementById(CLOUD_LABELS_GROUP_ID);
  if (!group) return () => {};
  const teardowns: (() => void)[] = [];
  const texts: SVGTextElement[] = [];
  clouds.clouds.forEach((cloud, idx) => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.id = `cloud-label-${idx}`;
    text.setAttribute('class', 'heliopause-label');
    text.setAttribute('text-anchor', 'start');
    text.setAttribute('dominant-baseline', 'hanging');
    text.textContent = cloud.name;
    group.appendChild(text);
    texts.push(text);
    teardowns.push(createShellSilhouetteLabel(ctx, {
      elementId: text.id,
      sampleCount: clouds.labelSampleCount(idx),
      getWorldSample: (i, out) =>
        clouds.labelSampleInto(idx, i, ctx.getWorldOffset(), out),
      visible: () =>
        !ctx.getMonochrome()
        && ctx.detailPermits('molecularCloudLabels')
        && renderedSizePx(idx) >= LABEL_MIN_SILHOUETTE_PX,
    }));
  });
  return () => {
    for (const stop of teardowns) stop();
    for (const text of texts) text.remove();
  };
}
