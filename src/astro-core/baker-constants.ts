// The physics half of baker-constants.json, and the file's only importer. See README.md#baker-constants.
import constants from './baker-constants.json';

/** The raw file, for `../catalog-format/baker-artifacts/`'s view of its artifact blocks. */
export const BAKER_CONSTANTS = constants;

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

export type ReliefBodyName = keyof typeof constants.surfaceRelief.bodies;

/** The bodies shipping DEM-derived relief, keyed by lowercased name. */
export const RELIEF_BODIES = Object.fromEntries(
  Object.entries(constants.surfaceRelief.bodies).map(([name, b]) => [
    name, { ...b, elevSpanM: span(b.elevSpanM) },
  ]),
) as Readonly<Record<ReliefBodyName, ReliefBody>>;

/** The relief body behind a texture key, or null for a body that ships none. */
export const reliefBodyOf = (key: string): ReliefBody | null =>
  Object.hasOwn(RELIEF_BODIES, key) ? RELIEF_BODIES[key as ReliefBodyName] : null;

export interface RingSpan {
  readonly innerRadiusKm: number;
  readonly outerRadiusKm: number;
}

/** The ring annuli the texture build draws strips for, keyed by lowercased name. */
export const RING_SPANS: Readonly<Record<keyof typeof constants.ringSpans, RingSpan>> =
  constants.ringSpans;
