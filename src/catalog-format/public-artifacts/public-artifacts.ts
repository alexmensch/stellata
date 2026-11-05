// The name of every file and folder the build ships and the viewer fetches. See README.md.
import {
  CLOUD_SURFACES_SCHEMA,
  CLOUDS_JSON_SCHEMA,
  DUST_MANIFEST_SCHEMA,
  LOCAL_BUBBLE_SCHEMA,
} from '../baker-artifacts/baker-artifacts';

export const PUBLIC_FILES = {
  constellations: 'constellations.json',
  searchIndex: 'search-index.json',
  boundaries: 'constellation-boundaries.json',
  binaries: 'binaries.bin',
  localBubble: LOCAL_BUBBLE_SCHEMA.fileName,
  cloudSurfaces: CLOUD_SURFACES_SCHEMA.fileName,
  clouds: CLOUDS_JSON_SCHEMA.fileName,
  localGroup: 'local-group.json',
} as const;

export const PUBLIC_FOLDERS = {
  dust: 'dust',
  probes: 'probes',
  ephemerides: 'ephemerides',
  textures: 'textures',
} as const;

export const DUST_MANIFEST = DUST_MANIFEST_SCHEMA.fileName;
export const DUST_CHUNK = /^chunk_\d+_\d+_\d+\.bin$/;

export const TEXTURE_MEMBERS = {
  // The rung width is required, so a stale pre-ladder `<body>.jpg` cannot ship as a file the renderer never asks for.
  colourMap: /^[a-z]+-\d+\.jpg$/,
  ringStrip: /^[a-z]+-rings\.png$/,
  reliefMap: /^[a-z]+-(normal|skyview|horizon-[ab])\.webp$/,
} as const;

/** A rostered folder member's name: a probe trajectory, a planet element table. */
export const rosterFileName = (id: string): string => `${id}.json`;
