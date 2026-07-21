import * as THREE from 'three';

import type { LgEmission } from '../../../scripts/local-group/build-local-group-pure';
import { viewingDistanceForExtent } from '../camera/focus/focus-transition';
import { sidColumnError } from '../util/sid-resolver';

export type LgKind = 'disc' | 'ellipsoid';
export type LgSource = 'LVDB' | 'OVERRIDE';
export type { LgEmission, SersicParams } from '../../../scripts/local-group/build-local-group-pure';

export interface LgObject {
  name: string;
  id: string;
  /** Morphological type for search rows + the focus card. */
  type: string;
  /** Extra typeable designations (catalog cross-IDs, common names). */
  aliases?: string[];
  /** Frozen Stellata ID (docs/sid.md § 7), stamped by the build. */
  sid: number;
  /** Absolute ICRS heliocentric position, parsecs. */
  centerAbs: THREE.Vector3;
  kind: LgKind;
  /** Local-frame semi-axes, parsecs. */
  axes: [number, number, number];
  /** Rotation from local frame to ICRS. */
  quat: THREE.Quaternion;
  source: LgSource;
  /** Heliocentric distance to the centroid in parsecs. */
  distanceFromSol: number;
  /** Solved luminosity model (docs/science-local-group.md § Local Group
   *  luminosity model) — consumed by the emission renderer. */
  emission: LgEmission;
}

export interface LgCatalog {
  count: number;
  objects: LgObject[];
}

/** Longest of the three local-frame semi-axes — the conservative upper
 *  bound on the object's projected silhouette radius regardless of
 *  orientation. Used by the apparent-size label ranking in local-group.ts
 *  and the hover pickbox in LocalGroupLayer.pick. */
export function maxSemiAxisPc(obj: Pick<LgObject, 'axes'>): number {
  return Math.max(obj.axes[0], obj.axes[1], obj.axes[2]);
}

/** Shortest of the three local-frame semi-axes — the lower bound used in
 *  the "Size <major> × <minor>" hover summary. */
export function minSemiAxisPc(obj: Pick<LgObject, 'axes'>): number {
  return Math.min(obj.axes[0], obj.axes[1], obj.axes[2]);
}

/** Recommended camera-to-centroid distance when focusing / warping to
 *  an LG object — the galaxy analogue of the clouds' viewing distance. */
export function lgViewingDistancePc(obj: Pick<LgObject, 'axes'>): number {
  return viewingDistanceForExtent(maxSemiAxisPc(obj));
}

interface RawObject {
  name: string;
  id: string;
  type: string;
  aliases?: string[];
  sid: number;
  center: [number, number, number];
  kind: LgKind;
  axes: [number, number, number];
  quat: [number, number, number, number];
  source: LgSource;
  distance: number;
  emission: LgEmission;
}

interface RawCatalog {
  version: number;
  count: number;
  objects: RawObject[];
}

/**
 * Fetch the Local Group catalog. Returns null if the file is missing
 * (fresh checkout without `pnpm run build:local-group`, or a deploy
 * that didn't include the artifact). Callers must treat null as
 * "no Local Group layer", not an error — same contract loadClouds
 * uses.
 */
export async function loadLocalGroup(url: string): Promise<LgCatalog | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const raw = (await res.json()) as RawCatalog;
  if (raw.version !== 2) {
    console.warn(`local-group.json version ${raw.version} unsupported`);
    return null;
  }
  const sidErr = sidColumnError(raw.objects.map((o) => o.sid));
  if (sidErr) {
    console.warn(`local-group.json ${sidErr} — rebuild with \`pnpm run build:local-group\``);
    return null;
  }
  const objects: LgObject[] = raw.objects.map((o) => ({
    name: o.name,
    id: o.id,
    type: o.type,
    ...(o.aliases ? { aliases: o.aliases } : {}),
    sid: o.sid,
    centerAbs: new THREE.Vector3(o.center[0], o.center[1], o.center[2]),
    kind: o.kind,
    axes: [o.axes[0], o.axes[1], o.axes[2]],
    quat: new THREE.Quaternion(o.quat[0], o.quat[1], o.quat[2], o.quat[3]),
    source: o.source,
    distanceFromSol: o.distance,
    emission: o.emission,
  }));
  return { count: raw.count, objects };
}
