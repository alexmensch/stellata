// public/clouds.json's wire schema. See README.md.

export type CloudSource = 'Z2021T1' | 'Z2020';

export type CloudClass = 'dark' | 'sf' | 'hii';

/** Embedded O/early-B star with its carved cavity (/docs/science-molecular-clouds.md#73-cavities-designed-not-yet-shipped). */
export interface EmbeddedStar {
  name: string;
  /** Absolute ICRS heliocentric position in parsecs. */
  xyz: [number, number, number];
  sptype: string;
  logQH: number;
  rCavPc: number;
}

/** One cloud as `build:clouds` assembles it, before its SID. */
export interface CloudRow {
  name: string;
  id: string;
  /** Absent when the build curated none, never empty. */
  aliases?: string[];
  /** ICRS heliocentric, pc. */
  center: [number, number, number];
  /** Semi-axes, pc; equal for a sphere. */
  axes: [number, number, number];
  /** Local frame → ICRS as [x, y, z, w]; identity for a sphere. */
  quat: [number, number, number, number];
  source: CloudSource;
  /** Heliocentric distance to the centroid, pc. */
  distance: number;
  /** M☉, Zucker 2021 (/data/papers/index.md#zucker2021) Table 3 `mass_nicest`; Z2021 clouds only. */
  mass?: number;
  class: CloudClass;
  sigmaS: number;
  seed: number;
  embedded: EmbeddedStar[];
  n0Cal: number;
  uEnv: number;
  rflat: number;
  p: number;
  massLeike: number | null;
  akPeak: number | null;
  /** Fully inside the dust voxel cube. */
  inGrid: boolean;
}

export interface CloudNoiseModel {
  lacunarity: number;
  betaSpectral: number;
  lambdaMinPc: number;
  domainStretchMajor: number;
  noiseClampSigma: number;
  ridgedFinestCount: number;
  ridgedExponent: Readonly<Record<CloudClass, number>>;
  sigmaS: Readonly<Record<CloudClass, number>>;
  hash: string;
  interp: string;
}

export interface CloudsFile {
  version: number;
  count: number;
  envelopeFadeStart: number;
  noiseModel: CloudNoiseModel;
  clouds: (CloudRow & { sid: number })[];
}
