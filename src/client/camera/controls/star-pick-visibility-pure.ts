// Whether the frame draws a star, and at what radius — the CPU mirror of
// every star.vert.glsl gate a pick has to honour. See README.md § picker.ts.

import { emitterPutsInkOnScreen } from '../../hdr/exposure/emitter-visibility-pure';
import { STAR_PASS_GLOW, colourPassFor } from '../../star-pipeline/star-pass';
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
  /** Re-solves the perceptual quad size at a dimmed magnitude
   *  (`star-physics.ts` `appSizePxForMag`). Only the eclipse branch calls
   *  it; `components.appSizePx` already carries the undimmed value. */
  appSizePxForMag: (appMag: number) => number;
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

  // Both the soft taper and the eclipse dim belong to the glow pass
  // alone. A star the disc pass draws keeps drawing at any dim — the
  // pair's overlap orders geometrically in the local depth pass — so
  // mirroring the dim there would hide a star that is on screen.
  const pass = colourPassFor(c.appSizePx, c.physSizePx);
  const dim = pass === STAR_PASS_GLOW ? a.eclipseDim : 1;
  if (dim <= 0) return { visible: false, hitRadius: 0 };

  // The shader folds the dim into appMag BEFORE deriving pxSize, so a
  // dimmed star draws a smaller quad as well as a fainter one; without the
  // re-solve the pick reach outruns the footprint by the whole dim.
  const appMag = dim < 1 ? c.appMag - 2.5 * Math.log10(dim) : c.appMag;
  const appSizePx = dim < 1 ? a.appSizePxForMag(appMag) : c.appSizePx;

  return {
    visible: emitterPutsInkOnScreen({
      appMag,
      exposure: a.exposure,
      thresholdMag: a.thresholdMag,
      physRadiusPx: 0.5 * c.physSizePxUncapped,
      whitePoint: a.whitePoint,
      tapered: pass === STAR_PASS_GLOW,
    }),
    hitRadius: discHitRadiusPx(Math.max(appSizePx, c.physSizePx)),
  };
}
