// Calibration acceptance: each LG object's integrated apparent V mag,
// through the shader's exact raymarch scheme (CPU mirror), matches the
// physical prediction from any camera position to ±0.1 mag. See README.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLvdb, parseOverrides } from '../../../scripts/local-group/build-local-group';
import {
  buildStandaloneOverride,
  filterForRendering,
  mergeRowAndOverride,
  roundN,
  type LgObject as BuildLgObject,
} from '../../../scripts/local-group/build-local-group-pure';
import {
  cpuRaymarchColumn,
  emissionMeshAxes,
  magFromIntensity,
  quatUnrotate,
} from './local-group-emission-pure';

const CALIBRATION_TOLERANCE_MAG = 0.1;
/** Far-field validity threshold: beyond 8 mesh radii the point-source
 *  1/d² law is accurate to ~0.02 mag — well inside the tolerance. */
const FAR_FIELD_MESH_RADII = 8;

const OUTSIDE_RAYS = 128;
const INSIDE_RAYS_THETA = 96;
const INSIDE_RAYS_PHI = 192;
const REFERENCE_RAY_SCALE = 1.5;
const REFERENCE_STEPS = 256;

type Vec3 = [number, number, number];

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data', 'local-group');
const lvdb = parseLvdb(readFileSync(join(dataDir, 'lvdb-snapshot.csv'), 'utf8'));
const overrides = parseOverrides(readFileSync(join(dataDir, 'overrides.tsv'), 'utf8'));
const overrideByName = new Map(overrides.map((o) => [o.name, o]));
const renderable = filterForRendering(lvdb);

function buildObject(name: string): BuildLgObject {
  const row = renderable.find((r) => r.name === name);
  if (row) return mergeRowAndOverride(row, overrideByName.get(name))!;
  return buildStandaloneOverride(overrideByName.get(name)!)!;
}

const OBJECTS = {
  lmc: buildObject('LMC'),
  smc: buildObject('SMC'),
  m31: buildObject('M31'),
  m33: buildObject('M33'),
  fornax: buildObject('Fornax'),
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Column intensity for one world-space ray against one object.
 *  Returns 0 when the ray misses the proxy ellipsoid. */
function rayColumn(
  camAbs: Vec3,
  dirWorld: Vec3,
  obj: BuildLgObject,
  steps: number,
): number {
  const axes = emissionMeshAxes(obj.emission);
  const rel = sub(camAbs, obj.center as Vec3);
  const oRaw = quatUnrotate(obj.quat, rel);
  const dRaw = quatUnrotate(obj.quat, dirWorld);
  const o: Vec3 = [oRaw[0] / axes[0], oRaw[1] / axes[1], oRaw[2] / axes[2]];
  const d: Vec3 = [dRaw[0] / axes[0], dRaw[1] / axes[1], dRaw[2] / axes[2]];
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 1;
  const disc = b * b - a * c;
  if (disc <= 0) return 0;
  const tExit = (-b + Math.sqrt(disc)) / a;
  if (tExit <= 0) return 0;
  const frag: Vec3 = [o[0] + tExit * d[0], o[1] + tExit * d[1], o[2] + tExit * d[2]];
  // dirWorld is unit length, so tExit IS worldPerT in parsecs.
  return cpuRaymarchColumn(o, frag, tExit, obj.emission, steps);
}

/** Orthonormal basis perpendicular to a unit vector. */
function basisFor(dir: Vec3): { e1: Vec3; e2: Vec3 } {
  const seed: Vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1raw: Vec3 = [
    dir[1] * seed[2] - dir[2] * seed[1],
    dir[2] * seed[0] - dir[0] * seed[2],
    dir[0] * seed[1] - dir[1] * seed[0],
  ];
  const l1 = norm(e1raw);
  const e1: Vec3 = [e1raw[0] / l1, e1raw[1] / l1, e1raw[2] / l1];
  const e2: Vec3 = [
    dir[1] * e1[2] - dir[2] * e1[1],
    dir[2] * e1[0] - dir[0] * e1[2],
    dir[0] * e1[1] - dir[1] * e1[0],
  ];
  return { e1, e2 };
}

/** Total flux number Φ = ∫ I dΩ from an OUTSIDE camera: pinhole grid
 *  over the object's bounding cone, per-pixel solid angle
 *  dx·dy / (1 + x² + y²)^{3/2}. */
function fluxOutside(camAbs: Vec3, obj: BuildLgObject, rays: number, steps: number): number {
  const axes = emissionMeshAxes(obj.emission);
  const toC = sub(obj.center as Vec3, camAbs);
  const dist = norm(toC);
  const cdir: Vec3 = [toC[0] / dist, toC[1] / dist, toC[2] / dist];
  const { e1, e2 } = basisFor(cdir);
  const sinT = Math.min(Math.max(axes[0], axes[1], axes[2]) / dist, 0.999);
  const X = Math.tan(Math.asin(sinT));
  const step = (2 * X) / rays;
  let flux = 0;
  for (let i = 0; i < rays; i++) {
    const x = -X + (i + 0.5) * step;
    for (let j = 0; j < rays; j++) {
      const y = -X + (j + 0.5) * step;
      const raw: Vec3 = [
        cdir[0] + x * e1[0] + y * e2[0],
        cdir[1] + x * e1[1] + y * e2[1],
        cdir[2] + x * e1[2] + y * e2[2],
      ];
      const l = norm(raw);
      const dir: Vec3 = [raw[0] / l, raw[1] / l, raw[2] / l];
      const dOmega = (step * step) / Math.pow(1 + x * x + y * y, 1.5);
      const col = rayColumn(camAbs, dir, obj, steps);
      if (col > 0) flux += col * dOmega;
    }
  }
  return flux;
}

/** Total flux from an INSIDE camera: full-sphere direction grid. */
function fluxInside(
  camAbs: Vec3,
  obj: BuildLgObject,
  nTheta: number,
  nPhi: number,
  steps: number,
): number {
  let flux = 0;
  const dTheta = Math.PI / nTheta;
  const dPhi = (2 * Math.PI) / nPhi;
  for (let i = 0; i < nTheta; i++) {
    const theta = (i + 0.5) * dTheta;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const dOmega = sinT * dTheta * dPhi;
    for (let j = 0; j < nPhi; j++) {
      const phi = (j + 0.5) * dPhi;
      const dir: Vec3 = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT];
      const col = rayColumn(camAbs, dir, obj, steps);
      if (col > 0) flux += col * dOmega;
    }
  }
  return flux;
}

function cameraInside(camAbs: Vec3, obj: BuildLgObject): boolean {
  const axes = emissionMeshAxes(obj.emission);
  const rel = quatUnrotate(obj.quat, sub(camAbs, obj.center as Vec3));
  const u = Math.hypot(rel[0] / axes[0], rel[1] / axes[1], rel[2] / axes[2]);
  return u <= 1;
}

const VIEWPOINTS: Record<string, Vec3> = {
  // Deep MW interior — the galactic centre (ICRS, McMillan R0 ≈ 8.2 kpc).
  galacticCentre: [-58.9, 7237.9, -3846.9],
  sun: [0, 0, 0],
  aboveDisc30kpc: [0, 0, 30_000],
  // 3 kpc off the LMC centroid — inside its 6 kpc emission envelope.
  nearLmc: [
    OBJECTS.lmc.center[0] + 3000,
    OBJECTS.lmc.center[1],
    OBJECTS.lmc.center[2],
  ] as Vec3,
  betweenMwAndM31: [
    OBJECTS.m31.center[0] * 0.5,
    OBJECTS.m31.center[1] * 0.5,
    OBJECTS.m31.center[2] * 0.5,
  ] as Vec3,
  beyondM33: [
    OBJECTS.m33.center[0] * 1.2,
    OBJECTS.m33.center[1] * 1.2,
    OBJECTS.m33.center[2] * 1.2,
  ] as Vec3,
};

describe('LG emission calibration — rendered flux vs physical prediction', () => {
  it('pins the catalog apparent magnitudes the solver calibrated against', () => {
    expect(OBJECTS.lmc.emission.mV).toBe(0.4);
    expect(OBJECTS.smc.emission.mV).toBe(2.2);
    expect(OBJECTS.m31.emission.mV).toBe(3.44);
    expect(OBJECTS.m33.emission.mV).toBe(5.72);
    expect(OBJECTS.fornax.emission.mV).toBe(7.377);
  });

  it(
    'every viewpoint × object lands within ±0.1 mag of the physical prediction',
    { timeout: 120_000 },
    () => {
      const deviations: { pair: string; dev: number }[] = [];
      for (const [vpName, cam] of Object.entries(VIEWPOINTS)) {
        for (const [objName, obj] of Object.entries(OBJECTS)) {
          const inside = cameraInside(cam, obj);
          const dist = norm(sub(obj.center as Vec3, cam));
          const meshRadius = Math.max(...emissionMeshAxes(obj.emission));

          const flux = inside
            ? fluxInside(cam, obj, INSIDE_RAYS_THETA, INSIDE_RAYS_PHI, 32)
            : fluxOutside(cam, obj, OUTSIDE_RAYS, 32);
          const mRendered = magFromIntensity(flux, 0);

          let mExpected: number;
          if (!inside && dist >= FAR_FIELD_MESH_RADII * meshRadius) {
            // Point-source limit: catalog magnitude scaled by 1/d².
            mExpected = obj.emission.mV + 5 * Math.log10(dist / obj.distance);
          } else {
            // Near-field / interior: converged march (denser rays +
            // 8× steps) of the same physical integral.
            const refFlux = inside
              ? fluxInside(
                  cam,
                  obj,
                  Math.round(INSIDE_RAYS_THETA * REFERENCE_RAY_SCALE),
                  Math.round(INSIDE_RAYS_PHI * REFERENCE_RAY_SCALE),
                  REFERENCE_STEPS,
                )
              : fluxOutside(
                  cam,
                  obj,
                  Math.round(OUTSIDE_RAYS * REFERENCE_RAY_SCALE),
                  REFERENCE_STEPS,
                );
            mExpected = magFromIntensity(refFlux, 0);
          }
          const dev = mRendered - mExpected;
          deviations.push({ pair: `${vpName}→${objName}`, dev });
          expect(
            Math.abs(dev),
            `${vpName}→${objName}: rendered ${mRendered.toFixed(3)} vs expected ${mExpected.toFixed(3)}`,
          ).toBeLessThan(CALIBRATION_TOLERANCE_MAG);
        }
      }
      // Headline pin: worst deviation across the full grid. A change to
      // the raymarch scheme, solver, or catalog moves this — re-derive,
      // don't loosen.
      const worst = deviations.reduce((a, b) => (Math.abs(b.dev) > Math.abs(a.dev) ? b : a));
      expect(deviations.length).toBe(30);
      expect(`${worst.pair}:${roundN(worst.dev, 3)}`).toBe(WORST_DEVIATION_PIN);
    },
  );
});

const WORST_DEVIATION_PIN = 'beyondM33→m31:0.011';
