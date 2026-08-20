// The per-draw attachment gate of hdr/attachments/README.md § The gate,
// re-expressed for WebGPU. See README.md § The gate becomes the output
// struct.

import { uniform } from 'three/tsl';

/** The frame-cost / adaptation-park masks, as uniform nodes an emitter's
 *  statistic write multiplies — writing the blend's identity element is
 *  what replaces masking the attachment off. One instance per boot; the
 *  HDR pipeline owns every write. */
export function makeEmitterGateNodes() {
  return {
    /** 1 while the statistic attachment accepts emitter writes; 0 under
     *  `setStatisticWritesEnabled(false)` or the adaptation park. */
    statisticWrites: uniform(1),
  };
}

export type EmitterGateNodes = ReturnType<typeof makeEmitterGateNodes>;
