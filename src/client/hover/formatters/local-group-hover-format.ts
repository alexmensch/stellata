// Local Group hover formatter — display name, camera-frame distance,
// kind ("Disc" | "Ellipsoid"), major × minor axis pair. See ./README.md.

import { fmtDistAuto } from '../../ui/distance-util';
import {
  maxSemiAxisPc,
  minSemiAxisPc,
  type LgObject,
} from '../../local-group/local-group-loader';
import type { HoverPayload } from '../hover-types';
import { formatAxisPair } from '../../format/physical-format';

export interface LocalGroupHoverFormatContext {
  objects: readonly LgObject[];
}

export function formatLocalGroupHover(
  idx: number,
  cameraDistancePc: number,
  ctx: LocalGroupHoverFormatContext,
): HoverPayload {
  const obj = ctx.objects[idx];
  if (!obj) return { name: '', lines: [] };
  const lines: string[] = [
    fmtDistAuto(cameraDistancePc),
    obj.kind === 'disc' ? 'Disc' : 'Ellipsoid',
    `Size ${formatAxisPair(maxSemiAxisPc(obj), minSemiAxisPc(obj))}`,
  ];
  return { name: obj.name, lines };
}

