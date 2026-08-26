// Ordering of the two halves of the chart palette swap. See README.md
// § Entry and exit are not mirror images.

/**
 * Run the HDR mode swap and the per-layer palette fan-out in the order the
 * MRT output struct allows.
 *
 * The chart blend sets `premultipliedAlpha`, and a material carrying that
 * flag cannot also carry the three-member output struct — three wraps the
 * output node and demotes it to one attachment, so
 * `webgpu/hdr/mrt-material.ts` throws rather than let the pipeline fail.
 * That makes the two directions asymmetric:
 *
 * - **Entering**, the struct must come off first, so the flag lands on a
 *   material already back on its single-output graph.
 * - **Leaving**, the flag must come off first, so the struct is re-enabled
 *   on a material that has already dropped it.
 *
 * Running the same order both ways throws on exit, and because the throw
 * escapes mid-fan-out it strands every later step in the caller too.
 */
export function applyChartPaletteSwap(
  on: boolean,
  hdrChartMode: (on: boolean) => void,
  layerPalettes: (on: boolean) => void,
): void {
  if (on) {
    hdrChartMode(true);
    layerPalettes(true);
  } else {
    layerPalettes(false);
    hdrChartMode(false);
  }
}
