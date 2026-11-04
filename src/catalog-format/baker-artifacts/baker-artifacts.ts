// The artifact half of baker-constants.json: what each Python-baked file's layout and encoding is. See README.md.
import { BAKER_CONSTANTS } from '../../astro-core/baker-constants';

export interface JsonArtifactSchema {
  readonly version: number;
}

/** A binary artifact opens with four ASCII magic bytes, then a uint32 LE version. */
export interface BinaryArtifactSchema extends JsonArtifactSchema {
  readonly magic: string;
}

const { artifacts, surfaceRelief } = BAKER_CONSTANTS;

export const CLOUDS_JSON_SCHEMA: JsonArtifactSchema = artifacts.clouds;
export const DUST_MANIFEST_SCHEMA: JsonArtifactSchema = artifacts.dustManifest;
export const CLOUD_SURFACES_SCHEMA: BinaryArtifactSchema = artifacts.cloudSurfaces;
export const LOCAL_BUBBLE_SCHEMA: BinaryArtifactSchema = artifacts.localBubble;

/** Azimuths a horizon map stores, and the full-scale of the sine it encodes. */
export const HORIZON_AZIMUTHS: number = surfaceRelief.horizonAzimuths;
export const HORIZON_SIN_RANGE: number = surfaceRelief.horizonSinRange;
/** Full-scale of the sky view factor a `<body>-skyview.webp` map encodes. */
export const SKY_VIEW_RANGE: number = surfaceRelief.skyViewRange;

/** Throws unless `view` opens with `schema`'s magic and version. */
export function checkBinaryHeader(
  view: DataView,
  schema: BinaryArtifactSchema,
  file: string,
): void {
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== schema.magic) {
    throw new Error(`${file}: bad magic (expected ${schema.magic})`);
  }
  const version = view.getUint32(4, true);
  if (version !== schema.version) {
    throw new Error(`${file}: unsupported version ${version} (expected ${schema.version})`);
  }
}

/** The bytes `checkBinaryHeader` accepts, for a test fixture to open with. */
export function writeBinaryHeader(view: DataView, schema: BinaryArtifactSchema): void {
  for (let i = 0; i < 4; i++) view.setUint8(i, schema.magic.charCodeAt(i));
  view.setUint32(4, schema.version, true);
}
