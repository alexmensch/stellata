// The reflected-glare billboard's own uniform nodes — the four slots
// PlanetBodyField owns rather than shares through the frame map.

import { Vector2 } from 'three';
import { uniform } from 'three/tsl';
import {
  GLARE_PHOTOCENTRE_SHIFT, MESH_FADE_FULL_PX, MESH_FADE_MIN_PX,
} from '../../solar-system/planets/mesh-crossfade';

export function glareUniformNodes() {
  return {
    /** Flat instance index to hide (−1 = none): observe mode parks the
     *  camera AT the focal body, whose glare would otherwise render from
     *  the interior. */
    uHideIdx: uniform(-1, 'int'),
    /** The active local-depth cluster's (start, count) slot range;
     *  (−1, 0) = none. One value drives the main-pass suppression and the
     *  mirror's member gate at opposite sense. */
    uLocalPassRange: uniform(new Vector2(-1, 0), 'ivec2'),
    /** Mesh resolvedness band in physical CSS px — the crescent
     *  photocentre shift fades in across it. */
    uMeshFadePx: uniform(new Vector2(MESH_FADE_MIN_PX, MESH_FADE_FULL_PX)),
    uGlarePhotocentreShift: uniform(GLARE_PHOTOCENTRE_SHIFT),
  };
}

export type GlareUniformNodes = ReturnType<typeof glareUniformNodes>;
