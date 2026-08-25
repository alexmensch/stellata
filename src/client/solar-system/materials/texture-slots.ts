// Which texture slots the solar-system surfaces carry, and the obligation
// each roster's slots come with. See README.md § Texture-slot rosters.

/**
 * The spheroid mesh's texture slots. Each one is **released back to its
 * own build-time stand-in** whenever its map is absent or not yet loaded
 * (`../planets/planet-mesh-layer.ts`), and each starts on a stand-in of
 * its own — three keys a texture uniform's binding on its value's uuid at
 * shader build, so two slots sharing one placeholder merge into a single
 * binding and the merged-away slot's later writes never reach the GPU.
 */
export const PLANET_MESH_TEXTURE_SLOTS = [
  'uMap', 'uNormalMap', 'uHorizonA', 'uHorizonB', 'uSkyView',
] as const;

/**
 * The ring annulus's texture slot. It gets the same per-slot stand-in and
 * **deliberately no release path**: an annulus has no representative-colour
 * fallback, so an unready ring map hides the ring rather than substituting
 * anything. Giving it one would be a visual change, not a bug fix.
 */
export const PLANET_RINGS_TEXTURE_SLOTS = ['uRingMap'] as const;

export type PlanetMeshTextureSlot = (typeof PLANET_MESH_TEXTURE_SLOTS)[number];
export type PlanetRingsTextureSlot = (typeof PLANET_RINGS_TEXTURE_SLOTS)[number];

/**
 * One entry per slot, keyed by the roster rather than by a restated
 * literal — so a factory cannot carry a subset, and a consumer still reads
 * `record.uMap` by name.
 */
export function textureSlotRecord<S extends readonly string[], V>(
  slots: S,
  make: (slot: S[number]) => V,
): { [K in S[number]]: V } {
  return Object.fromEntries(slots.map((s) => [s, make(s)])) as { [K in S[number]]: V };
}
