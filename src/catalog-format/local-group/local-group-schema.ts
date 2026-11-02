// Viewer-facing local-group.json types. See README.md.

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
