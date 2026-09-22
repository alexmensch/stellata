// The unit-square instanced quad every star-shaped emitter expands.

/** The per-vertex unit-square corner + index pair every star quad
 *  geometry starts from (the star layer's and the planet glare's).
 *  Corners span [-0.5, +0.5]². */
export const STAR_QUAD_CORNERS = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
export const STAR_QUAD_INDEX = [0, 1, 2, 1, 3, 2];
