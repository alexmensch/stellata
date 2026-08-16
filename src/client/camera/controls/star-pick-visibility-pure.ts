// Whether the frame draws a star, and at what radius — the CPU mirror of
// every star.vert.glsl gate a pick has to honour. See README.md § picker.ts.

import { emitterPutsInkOnScreen } from '../../hdr/exposure/emitter-visibility-pure';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { discHitRadiusPx, type ResolvedCandidate } from './star-geometry';
import type { RenderedSizeComponents } from './star-physics';

export interface StarPickVisibilityArgs {
  /** `uHideFocusIdx` matched this star — the focal star in OBSERVE, held
   *  pinned to the source through an observe-launched warp. The shader
   *  collapses it to the off-screen sentinel in every pass, so it is
   *  drawn nowhere while sitting dead centre of the screen. */
  focalHidden: boolean;
  /** `iEclipseDim`: 1 undimmed, exactly 0 at totality. */
  eclipseDim: number;
  /** Chart-mode ink disc diameter in px, or null outside chart mode. */
  chartDiscPx: number | null;
  /** Instrument limit — chart's hard clip. Chart inherits no exposure
   *  state, so nothing else in this call reaches its branch. */
  limitMag: number;
  components: RenderedSizeComponents;
  /** Live `uExposure`: the adaptation cut and the EV trim are in it. */
  exposure: number;
  thresholdMag: number;
  whitePoint: number;
}

export function resolveStarPickVisibility(a: StarPickVisibilityArgs): ResolvedCandidate {
  if (a.focalHidden) return { visible: false, hitRadius: 0 };
  const c = a.components;

  if (a.chartDiscPx !== null) {
    return {
      visible: c.appMag <= a.limitMag,
      hitRadius: discHitRadiusPx(a.chartDiscPx),
    };
  }

  const pxSize = Math.max(c.appSizePx, c.physSizePx);
  // The pass split: the fragment shader keeps this star in the glow pass
  // rather than the opaque disc pass. Both the soft taper and the eclipse
  // dim are glow-pass-only (`uRenderMode == 0`).
  const glowDominant = c.physSizePx < PHYS_RATIO_THRESHOLD * Math.max(pxSize, 0.001);
  // A disc-dominant star keeps drawing at any dim — the pair's overlap
  // orders geometrically in the local depth pass instead — so mirroring
  // the dim there would hide a star that is on screen.
  const dim = glowDominant ? a.eclipseDim : 1;
  if (dim <= 0) return { visible: false, hitRadius: 0 };

  return {
    visible: emitterPutsInkOnScreen({
      appMag: dim < 1 ? c.appMag - 2.5 * Math.log10(dim) : c.appMag,
      exposure: a.exposure,
      thresholdMag: a.thresholdMag,
      physRadiusPx: 0.5 * c.physSizePxUncapped,
      whitePoint: a.whitePoint,
      tapered: glowDominant,
    }),
    hitRadius: discHitRadiusPx(pxSize),
  };
}
