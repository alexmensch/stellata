// see data/schema/README.md
import constants from '../../../data/schema/constants.json';

export interface GalacticFrame {
  readonly centreRaDeg: number;
  readonly centreDecDeg: number;
  readonly northPoleRaDeg: number;
  readonly northPoleDecDeg: number;
}

export const GALACTIC_FRAME: GalacticFrame = constants.galacticFrame;

/** V-band extinction per unit Edenhofer/ZGR dust density: A_V = this · ∫E dl. */
export const AV_PER_EZGR: number = constants.extinction.avPerEzgr;

/** A_V rate [mag/pc] per hydrogen number density n_H [cm⁻³]. */
export const AV_PER_NH_PC: number = constants.extinction.avPerNhPc;

/** Limb-darkening floor and exponent — `mix(LIMB_FLOOR, 1, μ^LIMB_EXP)` — and
 *  the floor on the terminator-softness width. */
export const LIMB_FLOOR: number = constants.planetShading.limbFloor;
export const LIMB_EXP: number = constants.planetShading.limbExp;
export const TERM_SOFTNESS_FLOOR: number = constants.planetShading.termSoftnessFloor;

/** Azimuths a horizon map stores, and the full-scale of the sine it encodes. */
export const HORIZON_AZIMUTHS: number = constants.surfaceRelief.horizonAzimuths;
export const HORIZON_SIN_RANGE: number = constants.surfaceRelief.horizonSinRange;
/** Full-scale of the sky view factor a `<body>-skyview.webp` map encodes. */
export const SKY_VIEW_RANGE: number = constants.surfaceRelief.skyViewRange;

export interface ReliefBody {
  readonly radiusKm: number;
  readonly albedo: number;
  readonly mapCenterLonDeg: number;
  /** `[lowest, highest]` metres above the reference sphere. */
  readonly elevSpanM: readonly [number, number];
}

const span = (pair: readonly number[]): readonly [number, number] => {
  if (pair.length !== 2) throw new Error(`elevSpanM needs two values, got ${pair.length}`);
  return [pair[0], pair[1]];
};

/** The bodies shipping DEM-derived relief, keyed by lowercased name. */
export const RELIEF_BODIES: Readonly<Record<string, ReliefBody>> = Object.fromEntries(
  Object.entries(constants.surfaceRelief.bodies).map(([name, b]) => [
    name, { ...b, elevSpanM: span(b.elevSpanM) },
  ]),
);

export interface RingSpan {
  readonly innerRadiusKm: number;
  readonly outerRadiusKm: number;
}

/** The ring annuli the texture build draws strips for, keyed by lowercased name. */
export const RING_SPANS: Readonly<Record<string, RingSpan>> = constants.ringSpans;

export interface JsonArtifactSchema {
  readonly version: number;
}

/** A binary artifact opens with four ASCII magic bytes, then a uint32 LE version. */
export interface BinaryArtifactSchema extends JsonArtifactSchema {
  readonly magic: string;
}

export const CLOUDS_JSON_SCHEMA: JsonArtifactSchema = constants.artifacts.clouds;
export const DUST_MANIFEST_SCHEMA: JsonArtifactSchema = constants.artifacts.dustManifest;
export const CLOUD_SURFACES_SCHEMA: BinaryArtifactSchema = constants.artifacts.cloudSurfaces;
export const LOCAL_BUBBLE_SCHEMA: BinaryArtifactSchema = constants.artifacts.localBubble;

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
