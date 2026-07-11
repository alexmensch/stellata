// Molecular cloud hover formatter — name, camera-frame distance,
// major × minor axis pair. See ./README.md.

import type { Cloud } from '../../molecular-clouds/cloud-loader';
import { fmtDistAuto } from '../../ui/distance-util';
import type { HoverPayload } from '../hover-types';
import { formatAxisPair } from '../../format/physical-format';

export interface CloudHoverFormatContext {
  clouds: readonly Cloud[];
}

export function formatCloudHover(
  idx: number,
  cameraDistancePc: number,
  ctx: CloudHoverFormatContext,
): HoverPayload {
  const cloud = ctx.clouds[idx];
  if (!cloud) return { name: '', lines: [] };
  const [ax, ay, az] = cloud.axes;
  const major = Math.max(ax, ay, az);
  const minor = Math.min(ax, ay, az);
  const lines: string[] = [
    fmtDistAuto(cameraDistancePc),
    `Size ${formatAxisPair(major, minor)}`,
  ];
  return { name: cloud.name, lines };
}
