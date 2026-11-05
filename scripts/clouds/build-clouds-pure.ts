// clouds.json's records and the dust bake's column-check file, from the parsed Zucker tables. See README.md.

import { AV_PER_NH_PC, DUST_GRID_HALF_EXTENT_PC } from '../../src/astro-core/baker-constants';
import { GAL_TO_ICRS, galacticDirToIcrs } from '../../src/astro-core/galactic-coords';
import { CLOUDS_JSON_SCHEMA, ZUCKER_PROFILED_SCHEMA } from '../../src/catalog-format/baker-artifacts/baker-artifacts';
import type { CloudClass, CloudRow, CloudsFile } from '../../src/catalog-format/clouds/clouds-schema';
import { Quaternion, Vector3 } from 'three';
import {
  AV_TARGET_BY_CLASS,
  ENVELOPE_FADE_START,
  GAL_TO_ICRS_ROWS,
  MIN_AXIS_PC,
  NOISE_MODEL,
  SIGMA_S_BY_CLASS,
  SPHERE_PLUMMER_P,
  SPHERE_RFLAT_FRACTION,
  cloudClass,
  extentGeometry,
  fnv1a32,
  galToIcrs,
  type ProfiledCloud,
  type Vec3,
} from './cloud-model-pure';
import { siblingSlug } from '../sid/sibling-artifacts-pure';
import { roundEach, roundHalfEven } from '../util/round-pure';
import type { Sightline, Z2021Extent, Z2021Mass } from './zucker-parse';

/** Singleton Zucker 2020 sightlines: the small end of the 5–30 pc effective radii of local SF clouds. */
export const DEFAULT_SPHERE_RADIUS_PC = 5.0;

const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  Coraus: 'Corona Australis',
  Corona_Australis: 'Corona Australis',
  Oriona: 'Orion A',
  Orionb: 'Orion B',
  Orionlam: 'Orion λ',
  Orion_Lam: 'Orion λ',
  Aquila_Rift: 'Aquila Rift',
  Aquila_S: 'Aquila South',
  CMa_OB1: 'CMa OB1',
  Gem_OB1: 'Gem OB1',
  Mon_OB1_NGC2264: 'Mon OB1 / NGC 2264',
  Cam: 'Cam',
  CygnusX: 'Cygnus X',
  IC1396: 'IC 1396',
  IC2118: 'IC 2118',
  IC2944: 'IC 2944',
  IC443: 'IC 443',
  IC5146: 'IC 5146',
  NGC2362: 'NGC 2362',
  NGC6604: 'NGC 6604',
  Pipe_B59: 'Pipe (B59)',
};

export function displayName(raw: string): string {
  return Object.hasOwn(DISPLAY_NAME_OVERRIDES, raw) ? DISPLAY_NAME_OVERRIDES[raw] : raw.replaceAll('_', ' ');
}

/** Curated canonical name (null keeps the built one) and aliases, keyed by the frozen slug id, never the
 *  display name a canonical promotion changes. Precedence: README.md#alternate-names. */
export const CLOUD_ALT_NAMES: Readonly<Record<string, readonly [string | null, readonly string[]]>> = {
  'mon-ob1-ngc-2264': ['NGC 2264', ['Mon OB1', 'Cone Nebula', 'Christmas Tree Cluster']],
  m16: ['Eagle Nebula', ['M16', 'NGC 6611', 'IC 4703']],
  m17: ['Omega Nebula', ['M17', 'NGC 6618', 'Swan Nebula']],
  m20: ['Trifid Nebula', ['M20', 'NGC 6514']],
  'ic-443': ['Jellyfish Nebula', ['IC 443']],
  'ic-5146': ['Cocoon Nebula', ['IC 5146', 'Caldwell 19']],
  'ic-2118': ['Witch Head Nebula', ['IC 2118']],
  'ic-2944': ['Running Chicken Nebula', ['IC 2944', 'Lambda Centauri Nebula']],
  lagoon: [null, ['M8', 'NGC 6523']],
  'north-america': [null, ['NGC 7000', 'Caldwell 20']],
  california: [null, ['NGC 1499', 'Sh2-220']],
  rosette: [null, ['NGC 2237', 'NGC 2244', 'Caldwell 49']],
  coalsack: [null, ['Caldwell 99']],
  carina: [null, ['Carina Nebula', 'NGC 3372', 'Eta Carinae Nebula', 'Caldwell 92']],
  'ic-1396': [null, ["Elephant's Trunk Nebula"]],
};

/** Zucker 2021 raw name → the Zucker 2020 cloud its ellipsoid replaces. Zucker 2020 sub-regions inside a
 *  Zucker 2021 parent (Ophiuchus_Arc) are separate structures and stay. */
const Z2021_TO_Z2020_SUPPRESS: Readonly<Record<string, string>> = {
  Chamaeleon: 'Chamaeleon',
  Ophiuchus: 'Ophiuchus',
  Lupus: 'Lupus',
  Taurus: 'Taurus',
  Perseus: 'Perseus',
  Cepheus: 'Cepheus',
  Coraus: 'Corona_Australis',
  Pipe: 'Pipe_B59',
  Oriona: 'Orion',
  Orionb: 'Orion',
  Orionlam: 'Orion_Lam',
};

const DEG = Math.PI / 180;
const norm = (v: Vec3): number => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

export function inGrid(centreIcrs: Vec3, halfExtentsIcrs: readonly number[]): boolean {
  return centreIcrs.every((c, i) => Math.abs(c) + halfExtentsIcrs[i] <= DUST_GRID_HALF_EXTENT_PC);
}

type DensityModelFields = Pick<CloudRow,
  'class' | 'sigmaS' | 'seed' | 'embedded' | 'n0Cal' | 'uEnv' | 'rflat' | 'p' | 'massLeike' | 'akPeak'>;

function densityModelFields(
  rawName: string, radiusPc: number, profiled: ReadonlyMap<string, ProfiledCloud>,
): DensityModelFields {
  const cls: CloudClass = cloudClass(rawName);
  const common = { class: cls, sigmaS: SIGMA_S_BY_CLASS[cls], seed: fnv1a32(rawName), embedded: [] };
  const p = profiled.get(rawName);
  if (p !== undefined) {
    return {
      ...common,
      n0Cal: roundHalfEven(p.calibration.n0Cal, 2),
      uEnv: roundHalfEven(p.calibration.uEnv, 4),
      rflat: p.fit.rflat,
      p: p.fit.p,
      massLeike: p.massLeike,
      akPeak: p.akLeike,
    };
  }
  return {
    ...common,
    n0Cal: roundHalfEven(AV_TARGET_BY_CLASS[cls] / (2.0 * radiusPc * AV_PER_NH_PC), 2),
    uEnv: 1.0,
    rflat: roundHalfEven(SPHERE_RFLAT_FRACTION * radiusPc, 2),
    p: SPHERE_PLUMMER_P,
    massLeike: null,
    akPeak: null,
  };
}

export function z2021Clouds(
  extents: readonly Z2021Extent[],
  masses: ReadonlyMap<string, Z2021Mass>,
  profiled: ReadonlyMap<string, ProfiledCloud>,
): CloudRow[] {
  const quat = new Quaternion().setFromRotationMatrix(GAL_TO_ICRS);
  return extents.map((e) => {
    const { centreGal, axesGal } = extentGeometry(e);
    const centre = galToIcrs(centreGal);
    const half = GAL_TO_ICRS_ROWS.map((row) => row.reduce((s, m, j) => s + Math.abs(m) * axesGal[j], 0));
    const name = displayName(e.cloud);
    const mass = masses.get(e.cloud);
    return {
      name,
      id: siblingSlug(name, 'cloud'),
      center: roundEach(centre, 2),
      axes: roundEach(axesGal, 2),
      quat: roundEach([quat.x, quat.y, quat.z, quat.w] as const, 6),
      source: 'Z2021T1',
      distance: roundHalfEven(norm(centre), 1),
      inGrid: inGrid(centre, half),
      ...(mass !== undefined ? { mass: mass.massNicest } : {}),
      ...densityModelFields(e.cloud, Math.min(...axesGal), profiled),
    };
  });
}

export function z2020Clouds(
  grouped: ReadonlyMap<string, readonly Sightline[]>,
  suppress: ReadonlySet<string>,
  profiled: ReadonlyMap<string, ProfiledCloud>,
): CloudRow[] {
  return [...grouped].filter(([raw, s]) => !suppress.has(raw) && s.length > 0).map(([raw, sightlines]) => {
    const pts = sightlines.map((s) => {
      const p = galacticDirToIcrs(s.lDeg * DEG, s.bDeg * DEG, new Vector3()).multiplyScalar(s.dPc);
      return [p.x, p.y, p.z] as const;
    });
    const mean = (k: number): number => pts.reduce((s, p) => s + p[k], 0) / pts.length;
    const centre: Vec3 = [mean(0), mean(1), mean(2)];
    const radius = pts.length >= 2
      ? Math.max(Math.max(...pts.map((p) => norm([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]))), MIN_AXIS_PC)
      : DEFAULT_SPHERE_RADIUS_PC;
    const name = displayName(raw);
    const r = roundHalfEven(radius, 2);
    return {
      name,
      id: siblingSlug(name, 'cloud'),
      center: roundEach(centre, 2),
      axes: [r, r, r],
      quat: [0, 0, 0, 1],
      source: 'Z2020',
      distance: roundHalfEven(norm(centre), 1),
      inGrid: inGrid(centre, [radius, radius, radius]),
      ...densityModelFields(raw, radius, profiled),
    };
  });
}

/** Layers CLOUD_ALT_NAMES onto the built clouds; an entry matching no cloud id is a curation typo. */
export function applyAltNames(clouds: readonly Pick<CloudRow, 'id' | 'name' | 'aliases'>[]): void {
  const byId = new Map(clouds.map((c) => [c.id, c]));
  const orphans = Object.keys(CLOUD_ALT_NAMES).filter((id) => !byId.has(id)).sort();
  if (orphans.length > 0) throw new Error(`CLOUD_ALT_NAMES: no cloud matches ${orphans.join(', ')}`);
  for (const [id, [canonical, aliases]] of Object.entries(CLOUD_ALT_NAMES)) {
    const cloud = byId.get(id)!;
    if (canonical !== null) cloud.name = canonical;
    if (aliases.length > 0) cloud.aliases = [...aliases];
  }
}

export interface ZuckerTables {
  readonly sightlines: ReadonlyMap<string, readonly Sightline[]>;
  readonly extents: readonly Z2021Extent[];
  readonly masses: ReadonlyMap<string, Z2021Mass>;
  readonly profiled: readonly ProfiledCloud[];
}

/** Every cloud, Zucker 2021 winning an id both papers produce, sorted by lower-cased display name. */
export function buildClouds(t: ZuckerTables): { clouds: CloudRow[]; ellipsoids: number; spheres: number } {
  const profiled = new Map(t.profiled.map((p) => [p.rawName, p]));
  const z2021Names = new Set(t.extents.map((e) => e.cloud));
  const suppress = new Set(Object.entries(Z2021_TO_Z2020_SUPPRESS).filter(([raw]) => z2021Names.has(raw)).map(([, z20]) => z20));
  const ellipsoids = z2021Clouds(t.extents, t.masses, profiled);
  const spheres = z2020Clouds(t.sightlines, suppress, profiled);
  const byId = new Map<string, CloudRow>();
  for (const c of [...ellipsoids, ...spheres]) if (!byId.has(c.id)) byId.set(c.id, c);
  const clouds = [...byId.values()];
  applyAltNames(clouds);
  const key = (c: CloudRow): string => c.name.toLowerCase();
  clouds.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { clouds, ellipsoids: ellipsoids.length, spheres: spheres.length };
}

export function cloudsPayload(clouds: readonly CloudRow[], sids: readonly number[]): CloudsFile {
  return {
    version: CLOUDS_JSON_SCHEMA.version,
    count: clouds.length,
    envelopeFadeStart: ENVELOPE_FADE_START,
    noiseModel: NOISE_MODEL,
    clouds: clouds.map((c, i) => ({ ...c, sid: sids[i] })),
  };
}

export function zuckerProfiledPayload(profiled: readonly ProfiledCloud[]) {
  return {
    version: ZUCKER_PROFILED_SCHEMA.version,
    galToIcrs: GAL_TO_ICRS_ROWS,
    clouds: profiled.map((p) => ({
      name: p.rawName,
      centreIcrsPc: p.centreIcrsPc,
      axesGalPc: p.axesGalPc,
      avColumnTarget: p.avColumnTarget,
    })),
  };
}
