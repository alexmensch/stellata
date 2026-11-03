// The name of every file and folder the build ships and the viewer fetches. See README.md.

export const PUBLIC_FILES = {
  constellations: 'constellations.json',
  searchIndex: 'search-index.json',
  boundaries: 'constellation-boundaries.json',
  binaries: 'binaries.bin',
  localBubble: 'local-bubble.bin',
  cloudSurfaces: 'cloud-surfaces.bin',
  clouds: 'clouds.json',
  localGroup: 'local-group.json',
} as const;

export const PUBLIC_FOLDERS = {
  dust: 'dust',
  probes: 'probes',
  ephemerides: 'ephemerides',
  textures: 'textures',
} as const;

export const DUST_MANIFEST = 'manifest.json';
