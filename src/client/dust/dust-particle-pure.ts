// The particle sprite's authored constants. The graph imports them;
// ../webgpu/dust/dust-tsl-drift.test.ts holds it to naming each rather
// than restating a value.

/** Sprite footprint in CSS px at the bottom and top of the density
 *  window. Wide and dim on purpose: a single particle sits barely above
 *  the perceptual floor and dense regions read as fog only because dozens
 *  overlap (README.md). */
export const PARTICLE_MIN_PX = 30.0;
export const PARTICLE_MAX_PX = 80.0;

/** Brightness at the bottom of the density window, before strength. */
export const PARTICLE_DIM_FLOOR = 0.15;

/** Warm grey the sprite tints to. */
export const DUST_TINT: readonly [number, number, number] = [0.70, 0.55, 0.38];
