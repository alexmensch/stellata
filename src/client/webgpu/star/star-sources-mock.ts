// StarGeometrySources over a zero-filled StarPipeline, for tests that
// need the real WebGL-side attributes without a GL context.

import { StarPipeline } from '../../star-pipeline/star-pipeline';
import { makeStarPipelineOptions } from '../../star-pipeline/star-pipeline-mock';
import type { StarGeometrySources } from './star-geometry';

export function makeStarGeometrySources(count = 4): {
  sources: StarGeometrySources;
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
