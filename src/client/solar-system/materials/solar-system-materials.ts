// Which surfaces the solar-system layers build through the shared
// EmitterMaterial contract (`../../scene/emitter-material.ts`). See
// README.md.

import type { EmitterMaterial } from '../../scene/emitter-material';

/**
 * The solar-system surfaces built over their layer's own geometry. The
 * reflected-glare billboard builds a packed geometry of its own instead
 * (`../../webgpu/solar-system/README.md` § The glare packs).
 */
export interface SolarSystemMaterials {
  /** The lit spheroid: equirect sample, terminator, relief, casters, and
   *  the disc-airlight block. Alpha-composited over the diffuse field. */
  planetMesh(): EmitterMaterial;
  /** The ring annulus over its radial strip. */
  planetRings(): EmitterMaterial;
  /** The limb-halo shell, premultiplied-over. */
  planetAtmosphere(): EmitterMaterial;
  /** Depth-only, colour writes off: the main-pass pre-stamp of a body's
   *  silhouette, so background layers depth-fail inside it
   *  (`../planets/depth-stamp/README.md`). No uniforms. */
  planetDepthStamp(): EmitterMaterial;
}

/**
 * The probe glyph, built alone — `README.md` § Why the probe glyph is
 * split out.
 */
export interface ProbeMaterials {
  /** The fixed-pixel diamond, drawn by both the main-pass mesh and its
   *  local-pass mirror. */
  probeMarker(): EmitterMaterial;
}
