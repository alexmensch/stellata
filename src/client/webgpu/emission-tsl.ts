// TSL mirror of stellata_hdr_emission's point-source peak rule. Thin
// composition over emission-pure (README.md § TSL test pattern); the
// unit's contract is ../hdr/emission/README.md § Unit.

import { Fn, max, min, pow } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LUMA_CEIL } from '../hdr/emission/emission-pure';

type NF = Node<'float'>;

export const pointSourcePeakTsl = /* @__PURE__ */ Fn(
  ([exposure, appMag, physRadiusPx]: [NF, NF, NF]) => {
    const flux = exposure.mul(pow(10.0, appMag.mul(-0.4)));
    const spread = max(1.0, physRadiusPx.mul(physRadiusPx).mul(Math.PI));
    return min(flux.div(spread), LUMA_CEIL);
  },
);
