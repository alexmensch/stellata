// StarLayerSources over a zero-filled StarPipeline, for tests that need
// the real WebGL-side attributes without a GL context.

import { StarPipeline } from '../../star-pipeline/star-pipeline';
import { makeStarPipelineOptions } from '../../star-pipeline/star-pipeline-mock';
import type { StarLayerSources } from './star-tables';

export function makeStarLayerSources(count = 4): {
  sources: StarLayerSources;
  opts: ReturnType<typeof makeStarPipelineOptions>;
  pipe: StarPipeline;
} {
  const opts = makeStarPipelineOptions(count);
  const pipe = new StarPipeline(opts);
  return {
    opts,
    pipe,
    sources: {
      catalog: opts.catalog,
      logRadii: opts.logRadii,
      lumClassF32: opts.lumClassF32,
      distSol: opts.distSol,
      teffApsis: opts.teffApsis,
      boundingSphereRadiusPc: opts.boundingSphereRadiusPc,
      iPositionAttr: pipe.iPositionAttr,
      iCompositeSuppressAttr: pipe.iCompositeSuppressAttr,
      iEclipseDimAttr: pipe.iEclipseDimAttr,
      iSuppressPulsationAttr: pipe.iSuppressPulsationAttr,
    },
  };
}

/** A renderer that records compute dispatches and storage releases — what
 *  the layer touches outside construction. */
export function makeFakeStarRenderer() {
  const dispatches: unknown[][] = [];
  const released: unknown[] = [];
  return {
    dispatches,
    released,
    renderer: {
      compute: (nodes: unknown) => dispatches.push(Array.isArray(nodes) ? nodes : [nodes]),
      _attributes: { delete: (a: unknown) => released.push(a) },
    },
  };
}
