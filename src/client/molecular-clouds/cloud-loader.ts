import * as THREE from 'three';

import { sidColumnError } from '../util/sid-resolver';
import type { NoiseModel } from './cloud-presence-pure';

export type CloudSource = 'Z2021T1' | 'Z2020';

export type CloudClass = 'dark' | 'sf' | 'hii';

/** Embedded O/early-B star with its carved cavity (docs/molecular-clouds.md
 *  § 7.3). Empty until the A.5 cross-match populates it. */
export interface EmbeddedStar {
  name: string;
  /** Absolute ICRS heliocentric position in parsecs. */
  xyz: [number, number, number];
  sptype: string;
  logQH: number;
  rCavPc: number;
}

export interface Cloud {
  name: string;
  id: string;
  /** Frozen Stellata ID (docs/sid.md § 7), stamped by the build. */
  sid: number;
  /** Absolute ICRS heliocentric position in parsecs. */
  centerAbs: THREE.Vector3;
  /** Semi-axes in parsecs along the cloud's local x, y, z, descending. Equal for sphere clouds. */
  axes: [number, number, number];
  /** Orientation of the local frame relative to ICRS. Identity for sphere clouds. */
  quat: THREE.Quaternion;
  source: CloudSource;
  /** Heliocentric distance to the centroid in pc — precomputed for hover labels. */
  distanceFromSol: number;
  /** Cloud mass in solar masses (Zucker 2021 Table 3, NICEST extinction
   *  map). Null for Z2020 clouds, which carry no mass estimate. */
  massMsun: number | null;
  /** Taxonomy driving presence tint + noise shaping (docs/molecular-clouds.md § 7). */
  cloudClass: CloudClass;
  /** Calibrated presence-pass density model (docs/molecular-clouds.md § 4). */
  n0Cal: number;
  uEnv: number;
  rflatPc: number;
  p: number;
  /** Log-normal σ_s by class (docs/molecular-clouds.md § 5.1). */
  sigmaS: number;
  /** uint32 noise seed (FNV-1a of the raw table name). */
  seed: number;
  /** Cloud lies fully inside the ±1250 pc dust voxel cube; false → the
   *  cloud is presence-only (no per-star extinction). */
  inGrid: boolean;
  embedded: EmbeddedStar[];
}

export interface CloudCatalog {
  count: number;
  clouds: Cloud[];
  /** Presence-shader noise-ladder constants (docs/molecular-clouds.md § 5.2). */
  noiseModel: NoiseModel;
}

interface RawCloud {
  name: string;
  id: string;
  sid: number;
  center: [number, number, number];
  axes: [number, number, number];
  quat: [number, number, number, number];
  source: CloudSource;
  distance: number;
  mass?: number;
  class: CloudClass;
  n0Cal: number;
  uEnv: number;
  rflat: number;
  p: number;
  sigmaS: number;
  seed: number;
  inGrid: boolean;
  embedded: EmbeddedStar[];
}

interface RawCatalog {
  version: number;
  count: number;
  noiseModel: NoiseModel;
  clouds: RawCloud[];
}

/**
 * Fetch the molecular cloud catalog. Returns null if the file is missing
 * (fresh checkout without `pnpm run build:clouds`, or a deploy that didn't
 * include the artifact). Callers must treat null as "no clouds layer", not
 * an error.
 */
export async function loadClouds(url: string): Promise<CloudCatalog | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const raw = (await res.json()) as RawCatalog;
  if (raw.version !== 2) {
    console.warn(`clouds.json version ${raw.version} unsupported`);
    return null;
  }
  if (!raw.noiseModel) {
    console.warn('clouds.json v2 is missing the noiseModel block — rebuild with `pnpm run build:clouds`');
    return null;
  }
  const sidErr = sidColumnError(raw.clouds.map((c) => c.sid));
  if (sidErr) {
    console.warn(`clouds.json ${sidErr} — rebuild with \`pnpm run build:clouds\``);
    return null;
  }
  const clouds: Cloud[] = raw.clouds.map((c) => ({
    name: c.name,
    id: c.id,
    sid: c.sid,
    centerAbs: new THREE.Vector3(c.center[0], c.center[1], c.center[2]),
    axes: [c.axes[0], c.axes[1], c.axes[2]],
    quat: new THREE.Quaternion(c.quat[0], c.quat[1], c.quat[2], c.quat[3]),
    source: c.source,
    distanceFromSol: c.distance,
    massMsun: c.mass ?? null,
    cloudClass: c.class,
    n0Cal: c.n0Cal,
    uEnv: c.uEnv,
    rflatPc: c.rflat,
    p: c.p,
    sigmaS: c.sigmaS,
    seed: c.seed,
    inGrid: c.inGrid,
    embedded: c.embedded,
  }));
  return { count: raw.count, clouds, noiseModel: raw.noiseModel };
}
