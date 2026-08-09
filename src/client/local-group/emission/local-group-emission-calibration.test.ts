// Calibration acceptance: each LG object's integrated apparent V mag,
// through the shader's exact raymarch scheme (CPU mirror), matches the
// physical prediction from any camera position to ±0.1 mag. See README.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLvdb, parseOverrides } from '../../../../scripts/local-group/build-local-group';
import {
  buildStandaloneOverride,
  filterForRendering,
  MAX_DISTANCE_PC,
  mergeRowAndOverride,
  roundN,
  type LgObject as BuildLgObject,
} from '../../../../scripts/local-group/build-local-group-pure';
import {
  columnSurfaceBrightness,
  cpuDensityAt,
  cpuRaymarchColumn,
  emissionComponents,
  expandComponent,
  magFromIntensity,
  quatUnrotate,
  subPixelExpansion,
  type EmissionComponent,
} from './local-group-emission-pure';
import {
  footprintRadiusPc,
  pixelSolidAngleArcsec2,
} from '../../hdr/emission/emission-pure';
import {
  summationDownsample,
  summationMean,
  summationRadiusPx,
} from '../../hdr/summation/summation-pure';
import {
  BASE_EPOCH_EXPOSURE,
  DEFAULT_SUMMATION_ARCSEC2,
} from '../../hdr/exposure/exposure-epoch';
import { angularToPx } from '../../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../../camera/timing';
import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import { displayLevel, tonemapWhitePoint } from '../../hdr/tonemap-pure';

const CALIBRATION_TOLERANCE_MAG = 0.1;
/** Steps per line-of-sight column integration. The Sérsic centre is a cusp
 *  and converges slowly there, so this is set by the central column rather
 *  than by the profile's smooth part. */
const COLUMN_STEPS = 20_000;
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
const dataDir = join(here, '..', '..', '..', '..', 'data', 'local-group');
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

/** The whole shipped catalogue, assembled as `build-local-group.ts` does:
 *  every renderable LVDB row, then the standalone override rows LVDB does
 *  not carry (M31, M33). */
const ALL_OBJECTS: BuildLgObject[] = (() => {
  const out: BuildLgObject[] = [];
  const matched = new Set<string>();
  for (const row of renderable) {
    const merged = mergeRowAndOverride(row, overrideByName.get(row.name));
    if (!merged) continue;
    if (merged.source === 'OVERRIDE') matched.add(row.name);
    out.push(merged);
  }
  for (const ov of overrides) {
    if (matched.has(ov.name)) continue;
    const built = buildStandaloneOverride(ov);
    if (built) out.push(built);
  }
  return out;
})();

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Column intensity for one world-space ray against one component.
 *  Returns 0 when the ray misses the component's proxy ellipsoid. */
function componentRayColumn(
  camAbs: Vec3,
  dirWorld: Vec3,
  obj: BuildLgObject,
  comp: EmissionComponent,
  steps: number | undefined,
): number {
  const axes = comp.axesPc;
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
  return cpuRaymarchColumn(o, frag, tExit, comp, steps);
}

/** Additive-blend sum over the object's components — a disc+bulge
 *  object contributes both volumes to every ray, exactly as the two
 *  GPU passes composite. `steps` undefined → per-family defaults. */
function rayColumn(
  camAbs: Vec3,
  dirWorld: Vec3,
  obj: BuildLgObject,
  steps?: number,
  expansion = 1,
): number {
  let col = 0;
  for (const comp of emissionComponents(obj.emission)) {
    col += componentRayColumn(
      camAbs, dirWorld, obj, expandComponent(comp, expansion), steps,
    );
  }
  return col;
}

function objectMeshAxes(obj: BuildLgObject, expansion = 1): Vec3 {
  const comps = emissionComponents(obj.emission);
  return [0, 1, 2].map((i) =>
    Math.max(...comps.map((c) => c.axesPc[i])) * expansion,
  ) as Vec3;
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
function fluxOutside(
  camAbs: Vec3,
  obj: BuildLgObject,
  rays: number,
  steps?: number,
  expansion = 1,
): number {
  const axes = objectMeshAxes(obj, expansion);
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
      const col = rayColumn(camAbs, dir, obj, steps, expansion);
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
  steps?: number,
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
  const rel = quatUnrotate(obj.quat, sub(camAbs, obj.center as Vec3));
  return emissionComponents(obj.emission).some((comp) => {
    const u = Math.hypot(
      rel[0] / comp.axesPc[0],
      rel[1] / comp.axesPc[1],
      rel[2] / comp.axesPc[2],
    );
    return u <= 1;
  });
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
          const meshRadius = Math.max(...objectMeshAxes(obj));

          const flux = inside
            ? fluxInside(cam, obj, INSIDE_RAYS_THETA, INSIDE_RAYS_PHI)
            : fluxOutside(cam, obj, OUTSIDE_RAYS);
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

// The sub-pixel floor is the one place the renderer rewrites a solved
// profile mid-flight, so "flux-exact" has to be integrated rather than
// asserted from the algebra. `expandComponent` is the vertex stage's CPU
// twin: run the SAME flux integral over the expanded profile and the
// answer may not move. A k² where the shader wants k³, or a scale length
// that fails to ride the axes, shows up here as a magnitude shift.
/** Four decades tighter than the layer's own ±0.1 mag. The expansion is
 *  exact in closed form, so anything left is march discretisation, and
 *  the measured worst is 8e-6 mag — this is a correctness bound, not a
 *  tolerance. */
const EXPANSION_TOLERANCE_MAG = 1e-4;
const WORST_EXPANSION_PIN = 'm33@k20:-0.000008';

describe('sub-pixel expansion — flux through the real integral', () => {
  const MAX_K = 20;

  /** The floor only ever fires on a mesh under a pixel wide, so the
   *  expanded mesh still subtends a very narrow cone. Reproduce that:
   *  put the camera far enough out that even MAX_K leaves entry and exit
   *  a thin shell apart. Closer than this and the log-distributed march
   *  redistributes its own samples between the two runs, which measures
   *  the marcher rather than the expansion. */
  const FAR_FIELD_FLOOR_RADII = 500;

  function farCameraFor(obj: BuildLgObject): Vec3 {
    const d = FAR_FIELD_FLOOR_RADII * MAX_K * Math.max(...objectMeshAxes(obj));
    return [obj.center[0] + d, obj.center[1], obj.center[2]];
  }

  // The triple is flux-exact in closed form; what this measures is the
  // DISCRETISED march's residual, because expanding the mesh moves the
  // log-step distribution against the absolute S_MIN_PC floor. That
  // residual is the shader's too, so pin it rather than tolerate it.
  it('leaves the integrated magnitude unmoved at every expansion factor', () => {
    const deviations: { pair: string; dev: number }[] = [];
    for (const [name, obj] of Object.entries(OBJECTS)) {
      const cam = farCameraFor(obj);
      const base = magFromIntensity(fluxOutside(cam, obj, OUTSIDE_RAYS), 0);
      for (const k of [1.5, 4, MAX_K]) {
        const expanded = magFromIntensity(
          fluxOutside(cam, obj, OUTSIDE_RAYS, undefined, k), 0,
        );
        deviations.push({ pair: `${name}@k${k}`, dev: expanded - base });
      }
    }
    for (const { pair, dev } of deviations) {
      expect(Math.abs(dev), pair).toBeLessThan(EXPANSION_TOLERANCE_MAG);
    }
    const worst = deviations.reduce((a, b) => (Math.abs(b.dev) > Math.abs(a.dev) ? b : a));
    expect(deviations.length).toBe(15);
    expect(`${worst.pair}:${roundN(worst.dev, 6)}`).toBe(WORST_EXPANSION_PIN);
  });

  it('magnifies the profile rather than reshaping it', () => {
    // Same physical fraction of the mesh reads the same column before and
    // after — the identical profile at a different scale, which is what
    // makes the floor invisible rather than merely cheap.
    const disc = emissionComponents(OBJECTS.m31.emission)[0];
    const k = 7;
    const expanded = expandComponent(disc, k);
    for (const frac of [0.1, 0.4, 0.9]) {
      const p: Vec3 = [frac, 0, 0];
      const before = cpuDensityAt(p, disc) * disc.axesPc[0];
      const after = cpuDensityAt(p, expanded) * expanded.axesPc[0];
      expect(after).toBeCloseTo(before / (k * k), 12);
    }
  });

  // Which viewpoints the floor is actually FOR. From Sol the catalogue is
  // mostly resolved — dSphs are degrees across — so the floor is nearly
  // inert there. It earns its keep from the far half of the envelope,
  // where two thirds of the catalogue drops under a pixel.
  // The other half of the spheroid-gap invariant. u₉₉(n) alone is pinned
  // in build-local-group-pure.test.ts; what an observer actually sees is
  // the shipped uMax·R_e against the half-light shell the wireframe draws.
  it('keeps a spheroid mesh ~4.6x outside the ring it draws', () => {
    const fornax = OBJECTS.fornax;
    if (fornax.emission.family !== 'sersic') throw new Error('expected a spheroid');
    const meshSemiMajor = fornax.emission.uMax * fornax.emission.reffAxesPc[0];
    expect(roundN(meshSemiMajor / fornax.axes[0], 2)).toBe(4.56);
  });

  it('pins how much of the catalogue the floor catches, per viewpoint', () => {
    const pxPerRadian = 900 / ((50 * Math.PI) / 180);
    const subPixelFrom = (cam: Vec3) =>
      ALL_OBJECTS.filter((obj) => {
        const radiusPc = Math.max(...objectMeshAxes(obj));
        const dist = norm(sub(obj.center as Vec3, cam));
        return subPixelExpansion((radiusPc / dist) * pxPerRadian) > 1;
      }).length;

    expect(ALL_OBJECTS.length).toBe(123);
    expect(subPixelFrom([0, 0, 0])).toBe(11);
    expect(subPixelFrom([0, 0, 1_000_000])).toBe(59);
    expect(subPixelFrom([0, 0, MAX_DISTANCE_PC])).toBe(82);
  });
});

const WORST_DEVIATION_PIN = 'nearLmc→m31:0.017';

// The flux test above pins the INTEGRAL. Nothing in it constrains how
// that flux is distributed across the object, which is the half a viewer
// actually reads. M31 is the only LG object with published photometry
// detailed enough to check a profile against, and because the solver
// fixes total flux while R_d / R_e / n / B/T / i all come from
// publication, the profile has no free parameter left — these are
// therefore closed-form consequences, not fitted values.
describe('M31 surface-brightness profile vs published photometry', () => {
  const m31 = OBJECTS.m31;
  const disc = emissionComponents(m31.emission).find((c) => c.family === 'disc')!;

  /** Column through a component at projected radius `bPc`, face-on — which
   *  for an inclined disc is the major-axis cut. `bPc` = 0 is the central
   *  column, the peak the shader reaches. Fine-stepped rather than analytic
   *  because the Sérsic profile has no closed form. */
  function columnAt(comp: EmissionComponent, bPc: number, footprintPc = 0): number {
    const bx = bPc / comp.axesPc[0];
    if (bx >= 1) return 0;
    const zMax = Math.sqrt(1 - bx * bx);
    let col = 0;
    for (let i = 0; i < COLUMN_STEPS; i++) {
      const t = ((i + 0.5) / COLUMN_STEPS) * zMax;
      // Face-on, so the ray runs down z and the footprint has no share along
      // it — `footprintAlong([0,0,1], [0,0,1])` is 0.
      col +=
        cpuDensityAt([bx, 0, t], comp, footprintPc) *
        ((zMax / COLUMN_STEPS) * comp.axesPc[2]);
    }
    return 2 * col;
  }

  const combinedSbAt = (thetaArcsec: number, footprintPc = 0) =>
    columnSurfaceBrightness(
      emissionComponents(m31.emission).reduce(
        (sum, comp) =>
          sum + columnAt(comp, thetaArcsec * ARCSEC_TO_RAD * m31.distance, footprintPc),
        0,
      ),
    );

  /** Column straight down the disc normal — the face-on sightline. */
  function faceOnColumnAt(radiusPc: number): number {
    if (disc.family !== 'disc') throw new Error('expected the disc component');
    // ∫ρ₀·exp(−R/R_d)·exp(−|z|/z_d) dz over the full envelope.
    const vertical = 2 * disc.zdPc * (1 - Math.exp(-disc.axesPc[2] / disc.zdPc));
    return disc.density0 * Math.exp(-radiusPc / disc.rdPc) * vertical;
  }

  it("the disc's face-on central surface brightness satisfies Freeman's law", () => {
    // Freeman (1970) μ₀(V) = 21.65 ± 0.30 for spiral discs. The model was
    // never fitted to this — it falls out of the solved flux plus the
    // published R_d — so agreement is a real check on the deprojection.
    const mu0 = columnSurfaceBrightness(faceOnColumnAt(0));
    expect(mu0).toBeGreaterThan(21.35);
    expect(mu0).toBeLessThan(21.95);
    expect(roundN(mu0, 2)).toBe(21.45);
  });

  it('falls 1.0857 mag per scale length — exponential in flux, linear in mag', () => {
    // The reason a real M31 photograph shows no visible "exponential
    // cliff": a log display transfer turns an exponential disc into a
    // straight ramp. Pinned because it is the shape claim the layer makes.
    const mu = (r: number) => columnSurfaceBrightness(faceOnColumnAt(r));
    for (const n of [1, 2, 3]) {
      expect(mu(n * disc.rdPc) - mu(0)).toBeCloseTo(n * 1.0857, 2);
    }
  });

  it('structural inputs match the papers they are cited from', () => {
    // Courteau et al. 2011 (ApJ 739, 20): R_d = 5.3 ± 0.5 kpc,
    // R_e = 1.0 ± 0.2 kpc, n = 2.2 ± 0.3, at 785 ± 25 kpc.
    if (disc.family !== 'disc') throw new Error('expected the disc component');
    expect(disc.rdPc).toBe(5300);
    const bulge = emissionComponents(m31.emission).find((c) => c.family === 'sersic')!;
    if (bulge.family !== 'sersic') throw new Error('expected the bulge component');
    expect(bulge.axesPc[0] / bulge.uMax).toBeCloseTo(1000, 6);
    expect(1 / bulge.invN).toBeCloseTo(2.2, 6);
    expect(m31.distance).toBeGreaterThan(760_000);
    expect(m31.distance).toBeLessThan(810_000);
  });

  it('total magnitude sits between the as-observed and dereddened values', () => {
    // Catalogue m_V = 3.44 is RC3 as-observed; Tempel et al. 2011
    // (A&A 526, A155) Table 2 gives 3.24 intrinsic. The layer calibrates
    // to as-observed on purpose (docs/science-local-group.md § No dust),
    // so the difference IS the MW foreground it declines to remove.
    expect(m31.emission.mV).toBe(3.44);
    expect(m31.emission.mV - 3.24).toBeGreaterThan(0.1);
    expect(m31.emission.mV - 3.24).toBeLessThan(0.35);
  });

  // The footprint softening's whole claim: `ε = s/√12` makes a point-sampled
  // fragment carry the pixel's AREA average of the column. Without it the
  // raymarch reads the Sérsic cusp at the pixel centre, and no amount of
  // screen-space convolution downstream can undo that — the display
  // convolution can only average what the rasteriser sampled.
  //
  // The reference is a brute-force average of the unsoftened profile over the
  // pixel square, which is what the softening approximates to second order.
  it('softens the nucleus to the area average a pixel should carry', () => {
    const areaAverageSb = (thetaArcsec: number, pxArcsec: number) => {
      const n = 24;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const dx = ((i + 0.5) / n - 0.5) * pxArcsec;
        for (let j = 0; j < n; j++) {
          const dy = ((j + 0.5) / n - 0.5) * pxArcsec;
          acc += 10 ** (-0.4 * combinedSbAt(Math.hypot(thetaArcsec + dx, dy)));
        }
      }
      return -2.5 * Math.log10(acc / (n * n));
    };

    // Pinned per plate scale rather than bounded: the point of the √12 is
    // that the residual does NOT grow as the pixel does. Negative is
    // brighter than the area average — the softening slightly under-corrects
    // the cusp, and does so by the same tenth of a magnitude at 10° as at
    // 120°, against the 3.95 mag the point sample carries.
    const residual: Record<number, number> = {
      [FOV_MIN_DEG]: -0.092,
      50: -0.119,
      [FOV_MAX_DEG]: -0.076,
    };
    for (const fovDeg of [FOV_MIN_DEG, 50, FOV_MAX_DEG]) {
      const pxPerRadian = angularToPx(900, (fovDeg * Math.PI) / 180);
      const pxArcsec = 1 / (pxPerRadian * ARCSEC_TO_RAD);
      const footprint = footprintRadiusPc(m31.distance, pixelSolidAngleArcsec2(pxPerRadian));
      expect(combinedSbAt(0, footprint) - areaAverageSb(0, pxArcsec)).toBeCloseTo(
        residual[fovDeg],
        2,
      );
    }
  });

  // Why this layer does NOT take the Milky Way band's rod-summation display
  // gain (`../../hdr/emission/README.md` § Extended sources). That gain multiplies a
  // surface brightness by the eye's summation solid angle, which is the
  // flux in that patch only for a source uniform across it. M31's bulge
  // R_e is 4.4 arcmin against a 13.0 arcmin summation disc, so assuming
  // uniformity at the CENTRAL surface brightness claims 2.3 mag more flux
  // from one patch than the whole galaxy emits — impossible, and the
  // measurement that scopes the concession to the band.
  it('would claim more flux from one summation patch than it has in total', () => {
    const column = emissionComponents(m31.emission).reduce(
      (sum, comp) => sum + columnAt(comp, 0),
      0,
    );
    const centreSb = columnSurfaceBrightness(column);
    expect(centreSb).toBeCloseTo(15.3, 2);

    const claimed = centreSb - 2.5 * Math.log10(DEFAULT_SUMMATION_ARCSEC2);
    expect(claimed).toBeCloseTo(1.1, 2);
    expect(m31.emission.mV - claimed).toBeCloseTo(2.34, 2);

    // The 13.0 arcmin summation disc reaches only 1.5 R_e of the bulge, so
    // "uniform over the patch" is not close to true.
    const bulge = emissionComponents(m31.emission).find((c) => c.family === 'sersic')!;
    if (bulge.family !== 'sersic') throw new Error('expected the bulge component');
    const reArcmin =
      bulge.axesPc[0] / bulge.uMax / m31.distance / ARCSEC_TO_RAD / 60;
    expect(reArcmin).toBeCloseTo(4.43, 2);
    const summationRadiusArcmin =
      Math.sqrt(DEFAULT_SUMMATION_ARCSEC2 / Math.PI) / 60;
    expect(summationRadiusArcmin / reArcmin).toBeCloseTo(1.47, 2);
  });

  // The pass this layer's display level now goes through, measured against
  // the operation that is correct by construction: average the flux over the
  // summation patch FIRST, then gain by the patch area. `10^(−0.4·S̄)·Ω_sum`
  // IS that patch flux, so the ideal needs no free parameter — only an
  // integral, and every figure below is an absolute error rather than a
  // comparison with previous behaviour.
  describe('against convolve-then-gain', () => {
    const R_SUM_ARCSEC = Math.sqrt(DEFAULT_SUMMATION_ARCSEC2 / Math.PI);
    const TABLE_MAX_ARCSEC = 90 * 60;
    const TABLE_N = 900;

    // The patch integral samples the profile ~10^5 times per centre, so the
    // radially symmetric face-on profile is tabulated once. Built lazily —
    // 10^7 density evaluations are not worth paying on an unrelated run.
    let table: number[] | null = null;
    function fluxPerArcsec2(thetaArcsec: number): number {
      table ??= Array.from({ length: TABLE_N + 1 }, (_, i) =>
        10 ** (-0.4 * combinedSbAt((i / TABLE_N) * TABLE_MAX_ARCSEC)),
      );
      const x = (Math.abs(thetaArcsec) / TABLE_MAX_ARCSEC) * TABLE_N;
      if (x >= TABLE_N) return 0;
      const i = Math.floor(x);
      return table[i] + (table[i + 1] - table[i]) * (x - i);
    }

    /** Flux inside one summation patch centred `thetaArcsec` from the
     *  nucleus, integrated in polar coordinates about the patch centre. */
    function patchFlux(thetaArcsec: number): number {
      const nRho = 220;
      const nPhi = 180;
      let acc = 0;
      for (let i = 0; i < nRho; i++) {
        const rho = ((i + 0.5) / nRho) * R_SUM_ARCSEC;
        for (let j = 0; j < nPhi; j++) {
          const phi = ((j + 0.5) / nPhi) * 2 * Math.PI;
          acc +=
            fluxPerArcsec2(
              Math.sqrt(
                thetaArcsec * thetaArcsec +
                  rho * rho +
                  2 * thetaArcsec * rho * Math.cos(phi),
              ),
            ) * rho;
        }
      }
      return acc * (R_SUM_ARCSEC / nRho) * ((2 * Math.PI) / nPhi);
    }

    /** Magnitudes a gain of `omega` lands from ideal at `thetaArcsec`.
     *  Negative is too bright. */
    const errorMag = (thetaArcsec: number, omega: number) =>
      -2.5 *
      Math.log10((fluxPerArcsec2(thetaArcsec) * omega) / patchFlux(thetaArcsec));

    it('over-lifts the nucleus by 3.95 mag if the band gain is reused', () => {
      expect(errorMag(0, DEFAULT_SUMMATION_ARCSEC2)).toBeCloseTo(-3.95, 2);
    });

    it('under-lifts the smooth disc by the full Ω ratio on the pixel angle', () => {
      // Outside ~4 arcmin the profile is uniform over a 13 arcmin patch to
      // better than 0.02 mag, so the ideal collapses onto the band's own
      // gain and a per-pixel shortfall is the Ω ratio — the same 2.695 mag
      // the band gained. This is what the retired per-layer opt-out cost
      // over most of the object a viewer sees.
      const omegaPx = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
      const ratioMag = 2.5 * Math.log10(DEFAULT_SUMMATION_ARCSEC2 / omegaPx);
      expect(ratioMag).toBeCloseTo(2.695, 3);
      for (const arcmin of [25, 40, 60]) {
        const theta = arcmin * 60;
        expect(errorMag(theta, DEFAULT_SUMMATION_ARCSEC2)).toBeCloseTo(0, 1.5);
        // The two gains differ by the Ω ratio at every θ by construction, so
        // the shortfall is the ratio plus whatever non-uniformity is left.
        expect(errorMag(theta, omegaPx) - errorMag(theta, DEFAULT_SUMMATION_ARCSEC2))
          .toBeCloseTo(ratioMag, 9);
        expect(errorMag(theta, omegaPx)).toBeGreaterThan(2.7);
        expect(errorMag(theta, omegaPx)).toBeLessThan(2.72);
      }
    });

    it('crosses over at 3.6 arcmin', () => {
      expect(errorMag(3.0 * 60, DEFAULT_SUMMATION_ARCSEC2)).toBeLessThan(0);
      expect(errorMag(4.0 * 60, DEFAULT_SUMMATION_ARCSEC2)).toBeGreaterThan(0);
    });

    // A per-fragment `fwidth(S)` cap on the effective summation area was the
    // cheap alternative to a convolution pass. Rejected, and pinned so it is
    // not re-proposed: the over-count is driven by CURVATURE while fwidth is
    // a first derivative, so at the nucleus — where the profile is flat and
    // the error is worst — the cap does not bind at all. Everywhere else it
    // over-corrects, landing fainter than ideal by more than not capping.
    it('is not rescued by a fwidth(S)-derived cap', () => {
      const cappedError = (thetaArcsec: number) => {
        const h = Math.max(thetaArcsec * 1e-3, 0.5);
        const gradPerArcsec = Math.abs(
          (combinedSbAt(thetaArcsec + h) - combinedSbAt(thetaArcsec - h)) / (2 * h),
        );
        const scale = gradPerArcsec > 0 ? 1 / gradPerArcsec : Infinity;
        return errorMag(
          thetaArcsec,
          Math.min(DEFAULT_SUMMATION_ARCSEC2, Math.PI * scale * scale),
        );
      };
      expect(cappedError(0)).toBeCloseTo(errorMag(0, DEFAULT_SUMMATION_ARCSEC2), 2);
      for (const arcmin of [0.5, 2, 6.5]) {
        expect(cappedError(arcmin * 60)).toBeGreaterThan(1.5);
      }
    });

    // What the shipped pass actually delivers: the softened profile a
    // fragment writes, box-averaged by the downsample factor, convolved with
    // the flat summation disc — every stage of `../../hdr/summation/README.md`
    // run on the CPU against the same ideal. `10^(−0.4·S̄)·Ω_sum` is the patch
    // flux, so `patchFlux / Ω_sum` is the mean the convolution should return
    // and the Ω_sum gain cancels out of the comparison.
    const softTables = new Map<number, number[]>();
    function softFluxPerArcsec2(thetaArcsec: number, fovDeg: number): number {
      let soft = softTables.get(fovDeg);
      if (soft === undefined) {
        const footprintPc = footprintRadiusPc(
          m31.distance,
          pixelSolidAngleArcsec2(angularToPx(900, (fovDeg * Math.PI) / 180)),
        );
        soft = Array.from({ length: TABLE_N + 1 }, (_, i) =>
          10 ** (-0.4 * combinedSbAt((i / TABLE_N) * TABLE_MAX_ARCSEC, footprintPc)),
        );
        softTables.set(fovDeg, soft);
      }
      const x = (Math.abs(thetaArcsec) / TABLE_MAX_ARCSEC) * TABLE_N;
      if (x >= TABLE_N) return 0;
      const i = Math.floor(x);
      return soft[i] + (soft[i + 1] - soft[i]) * (x - i);
    }

    /** Mean display level the pass produces at `thetaArcsec`, in flux per
     *  arcsec² — the Ω_sum gain is common to both sides.
     *
     *  Each tap is the box average of a continuously-positioned cell, where
     *  the shader takes a BILINEAR read of the discrete downsample grid at
     *  `fragCoord / factor` — generally off-centre, so it mixes four texels.
     *  That is ~one texel of further smoothing this mirror does not model, so
     *  the residuals below are the ideal kernel's rather than the shader's.
     *  It bounds them from the sharp side: bilinear can only smooth further,
     *  and every pin here is "the core is not brighter than ideal". */
    function shippedMean(thetaArcsec: number, fovDeg: number): number {
      const pxPerRadian = angularToPx(900, (fovDeg * Math.PI) / 180);
      const pxArcsec = 1 / (pxPerRadian * ARCSEC_TO_RAD);
      const radiusPx = summationRadiusPx(
        DEFAULT_SUMMATION_ARCSEC2,
        pixelSolidAngleArcsec2(pxPerRadian),
      );
      const factor = summationDownsample(radiusPx);
      const texelArcsec = pxArcsec * factor;
      // One source texel: the box average of factor² pixel samples, which is
      // what the downsample stage writes.
      const texel = (dx: number, dy: number) => {
        const cx = thetaArcsec + dx * texelArcsec;
        const cy = dy * texelArcsec;
        let acc = 0;
        for (let i = 0; i < factor; i++) {
          const x = cx + ((i + 0.5) / factor - 0.5) * texelArcsec;
          for (let j = 0; j < factor; j++) {
            const y = cy + ((j + 0.5) / factor - 0.5) * texelArcsec;
            acc += softFluxPerArcsec2(Math.hypot(x, y), fovDeg);
          }
        }
        return acc / (factor * factor);
      };
      return summationMean(texel, radiusPx / factor);
    }

    const shippedError = (thetaArcsec: number, fovDeg: number) =>
      -2.5 *
      Math.log10(
        shippedMean(thetaArcsec, fovDeg) /
          (patchFlux(thetaArcsec) / DEFAULT_SUMMATION_ARCSEC2),
      );

    // The acceptance. Pinned per plate scale because the point is that the
    // error does NOT grow as the pixel does — positive throughout, so the
    // core lands slightly faint rather than bright, which is the direction a
    // 4-magnitude white nucleus made non-negotiable.
    it('lands the nucleus within a tenth of a magnitude at every FOV', () => {
      const nucleus: Record<number, number> = {
        [FOV_MIN_DEG]: 0.029,
        20: 0.079,
        30: 0.045,
        50: 0.089,
        90: 0.179,
        [FOV_MAX_DEG]: 0.148,
      };
      for (const [fovDeg, expected] of Object.entries(nucleus)) {
        const err = shippedError(0, Number(fovDeg));
        expect(err).toBeCloseTo(expected, 2);
        // Positive everywhere: the nucleus is never brighter than ideal, at
        // any plate scale. Reusing the band's gain put it 3.95 mag over.
        expect(err).toBeGreaterThan(0);
      }
    });

    // The half the retired opt-out got wrong by 2.695 mag, over most of the
    // object a viewer sees — and it is now FOV-invariant, which is the other
    // acceptance criterion: M31 and the band respond to the field the same
    // way because neither carries a plate scale any more.
    // What a viewer actually sees, in 8-bit levels at the base epoch and the
    // reference viewport — the distribution half of the acceptance, and the
    // half the § against convolve-then-gain errors above cannot show. A
    // threshold star lands on 38.25 (../../hdr/tonemap-pure.ts), so M31 reads
    // brighter than one out to ~15 arcmin — the core and inner disc the
    // naked eye actually gets. The outer rows sit under the extended
    // threshold, so the faint-end toe compresses them: the 40-arcmin
    // envelope reads ~1.5/255 where the near-linear curve gave it 18.
    //
    // Under the retired per-layer opt-out the same rows ran 173 at the core
    // and 0.8 at 40 arcmin — a bright nucleus on a black disc. The core comes
    // DOWN here and the envelope comes up, because the patch average dilutes
    // a cusp and lifts a smooth profile.
    it('pins the levels M31 renders at across its profile', () => {
      const level = (arcmin: number) =>
        255 *
        displayLevel(
          BASE_EPOCH_EXPOSURE * shippedMean(arcmin * 60, 50) * DEFAULT_SUMMATION_ARCSEC2,
          tonemapWhitePoint(),
        );
      expect(level(0)).toBeCloseTo(120.0, 1);
      expect(level(10)).toBeCloseTo(64.1, 1);
      expect(level(20)).toBeCloseTo(34.18, 1);
      expect(level(40)).toBeCloseTo(1.54, 1);
      // Monotonic outward, which "a bright core with a faint oval" requires
      // and a convolution could break if the kernel were asymmetric.
      for (const arcmin of [5, 10, 20, 30, 40]) {
        expect(level(arcmin)).toBeLessThan(level(arcmin - 5));
      }
    });

    it('holds the smooth envelope at every FOV', () => {
      for (const arcmin of [16, 25, 40]) {
        const theta = arcmin * 60;
        for (const fovDeg of [FOV_MIN_DEG, 50, FOV_MAX_DEG]) {
          // Under 0.08 mag against an ideal that needs no free parameter,
          // and negative — the envelope is marginally over rather than the
          // 2.695 mag under it used to sit.
          expect(Math.abs(shippedError(theta, fovDeg))).toBeLessThan(0.08);
        }
        // Worst spread across the whole FOV range is 0.069 mag, at 16 arcmin
        // and 120° — where the patch is sub-pixel and 16 arcmin is two pixels
        // from the nucleus. Against 5.4 mag of drift on the pixel angle.
        const spread = Math.abs(
          shippedError(theta, FOV_MIN_DEG) - shippedError(theta, FOV_MAX_DEG),
        );
        expect(spread).toBeLessThan(0.07);
      }
    });
  });
});
