// Codec for data/classic-ids/hd_hip_route_disagreements.tsv. See README.md#files-in-this-area.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { OVERLAY_VALUE_SEPARATOR } from './classic-id-overlay-pure';

export interface HdHipRouteDisagreement {
  hd: number;
  hip: number;
  hdRouteSourceIds: string[];
  hipRouteSourceId: string;
}

export const ROUTE_DISAGREEMENTS = defineArtifact({
  file: 'data/classic-ids/hd_hip_route_disagreements.tsv',
  columns: ['hd', 'hip', 'hd_route_source_ids', 'hip_route_source_id'] as const,
  hint: 'Re-run `pnpm run build:classic-ids`.',
  order: (a: HdHipRouteDisagreement, b: HdHipRouteDisagreement) => a.hd - b.hd,
  decode: (row): HdHipRouteDisagreement => ({
    hd: row.int('hd') ?? row.fail('hd is empty'),
    hip: row.int('hip') ?? row.fail('hip is empty'),
    hdRouteSourceIds: row.sourceIdList('hd_route_source_ids', OVERLAY_VALUE_SEPARATOR),
    hipRouteSourceId: row.requiredSourceId('hip_route_source_id'),
  }),
  encode: (d) => ({
    hd: String(d.hd),
    hip: String(d.hip),
    hd_route_source_ids: d.hdRouteSourceIds.join(OVERLAY_VALUE_SEPARATOR),
    hip_route_source_id: d.hipRouteSourceId,
  }),
});
