// Which texture slots the solar-system surfaces carry, and the obligation
// each roster's slots come with. See README.md § Texture-slot rosters.

/**
 * Each slot needs a stand-in of its OWN: three keys a texture uniform's
 * binding on its value's uuid at shader build, so two slots sharing one
 * placeholder merge into a single binding and the merged-away slot's later
 * writes never reach the GPU.
 */
export const PLANET_MESH_TEXTURE_SLOTS = [
  'uMap', 'uNormalMap', 'uHorizonA', 'uHorizonB', 'uSkyView',
] as const;

/** Deliberately fallback-free — README.md § Texture-slot rosters. */
export const PLANET_RINGS_TEXTURE_SLOTS = ['uRingMap'] as const;

export type PlanetMeshTextureSlot = (typeof PLANET_MESH_TEXTURE_SLOTS)[number];

export function textureSlotRecord<S extends readonly string[], V>(
  slots: S,
  make: (slot: S[number]) => V,
): { [K in S[number]]: V } {
  return Object.fromEntries(slots.map((s) => [s, make(s)])) as { [K in S[number]]: V };
}
