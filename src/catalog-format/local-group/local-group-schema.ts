// public/local-group.json's wire schema. See README.md.

/** Max heliocentric distance (parsecs) we render — README.md#max_distance_pc. */
export const MAX_DISTANCE_PC = 2_000_000;

/** Solved Sérsic component — shared by the spheroid family and the
 *  M31 bulge (DRY at schema level). Axes in parsecs; density0 in the
 *  zero-point-free flux-number units the ρ₀ solve works in. */
export interface SersicParams {
  reffAxesPc: [number, number, number];
  n: number;
  bn: number;
  pn: number;
  uMax: number;
  density0: number;
}

export type LgEmission =
  | ({ family: 'sersic'; mV: number; color?: string } & SersicParams)
  | {
      family: 'disc';
      mV: number;
      color?: string;
      rdPc: number;
      zdPc: number;
      rEnvPc: number;
      zEnvPc: number;
      density0: number;
      bulge?: SersicParams;
    };

export type LgKind = 'disc' | 'ellipsoid';
export type LgSource = 'LVDB' | 'OVERRIDE';

export const LOCAL_GROUP_VERSION = 2;

/** One object as `build:local-group` assembles it, before its SID. */
export interface LgObjectRow {
  name: string;
  id: string;
  /** Morphological type for search rows + the focus card. */
  type: string;
  /** Extra typeable designations (catalog cross-IDs, common names). */
  aliases?: string[];
  /** Heliocentric ICRS position, parsecs. */
  center: [number, number, number];
  kind: LgKind;
  /** Local-frame semi-axes, parsecs. */
  axes: [number, number, number];
  /** Rotation from local frame to ICRS as a unit quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  source: LgSource;
  /** Heliocentric distance to the centroid in parsecs — precomputed for
   *  ready-to-display readouts on the runtime side. */
  distance: number;
  emission: LgEmission;
}

export interface LocalGroupFile {
  version: number;
  count: number;
  objects: (LgObjectRow & { sid: number })[];
}
