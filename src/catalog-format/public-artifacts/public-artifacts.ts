// The name of every file and folder the build writes under public/ and the viewer fetches. See README.md.

export const PUBLIC_DIR = 'public';

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

export type PublicFile = (typeof PUBLIC_FILES)[keyof typeof PUBLIC_FILES];
export type PublicFolder = (typeof PUBLIC_FOLDERS)[keyof typeof PUBLIC_FOLDERS];

/** Repo-relative path of a public artifact, as the step table and the mirrors spell outputs. */
export function publicRepoPath(name: PublicFile | PublicFolder | `${PublicFolder}/${string}`): string {
  return `${PUBLIC_DIR}/${name}`;
}
