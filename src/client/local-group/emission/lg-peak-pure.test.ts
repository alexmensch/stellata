import { describe, expect, it } from 'vitest';
import { pixelSolidAngleArcsec2 } from '../../hdr/emission/emission-pure';
import { angularToPx } from '../../camera/controls/star-geometry';
import {
  columnSurfaceBrightness,
  cpuRaymarchColumn,
  emissionComponents,
  expandComponent,
  quatRotate,
  quatUnrotate,
} from './local-group-emission-pure';
import {
  LG_PEAK_JITTER_PHASES,
  LG_PEAK_RECOMPUTE_PC,
  LgPeakCache,
  type LgPeakSource,
  centralRayColumnAtPhase,
  componentPeakColumn,
  lgPeakSurfaceBrightness,
  objectPeakSurfaceBrightness,
} from './lg-peak-pure';
import { ALL_OBJECTS, type BuildLgObject, buildObject } from './lg-catalog-fixture';

type Vec3 = readonly [number, number, number];

const SOL: Vec3 = [0, 0, 0];
/** The acceptance plate scale: 50° vertical FOV on 900 CSS px. */
const PX_PER_RAD_50 = angularToPx(900, (50 * Math.PI) / 180);
const OMEGA_PX_50DEG = pixelSolidAngleArcsec2(PX_PER_RAD_50);
const OMEGA_PX_10DEG = pixelSolidAngleArcsec2(angularToPx(900, (10 * Math.PI) / 180));
const OMEGA_PX_120DEG = pixelSolidAngleArcsec2(angularToPx(900, (120 * Math.PI) / 180));

const FIVE = ['LMC', 'SMC', 'M31', 'M33', 'Fornax'].map(buildObject);

function asSource(o: BuildLgObject): LgPeakSource {
  return {
    centerAbs: { x: o.center[0], y: o.center[1], z: o.center[2] },
    quat: { x: o.quat[0], y: o.quat[1], z: o.quat[2], w: o.quat[3] },
    emission: o.emission,
  };
}

/** One shader ray through `pointWorld` from `camAbs`, at the mirror's own
 *  midpoint phase, summed over the object's components. */
function shaderRaySb(o: BuildLgObject, camAbs: Vec3, pointWorld: Vec3, omegaPx: number): number {
  let column = 0;
  for (const comp of emissionComponents(o.emission)) {
    const rel: Vec3 = [camAbs[0] - o.center[0], camAbs[1] - o.center[1], camAbs[2] - o.center[2]];
    const cam = quatUnrotate(o.quat, rel).map((v, i) => v / comp.axesPc[i]) as [number, number, number];
    const through: Vec3 = [pointWorld[0] - o.center[0], pointWorld[1] - o.center[1], pointWorld[2] - o.center[2]];
    const pt = quatUnrotate(o.quat, through).map((v, i) => v / comp.axesPc[i]) as [number, number, number];
    const d: Vec3 = [pt[0] - cam[0], pt[1] - cam[1], pt[2] - cam[2]];
    const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const b = cam[0] * d[0] + cam[1] * d[1] + cam[2] * d[2];
    const c = cam[0] * cam[0] + cam[1] * cam[1] + cam[2] * cam[2] - 1;
    const disc = b * b - a * c;
    if (disc <= 0) continue;
    const tExit = (-b + Math.sqrt(disc)) / a;
    const frag: [number, number, number] = [cam[0] + tExit * d[0], cam[1] + tExit * d[1], cam[2] + tExit * d[2]];
    const fragWorld = quatRotate(o.quat, [
      frag[0] * comp.axesPc[0], frag[1] * comp.axesPc[1], frag[2] * comp.axesPc[2],
    ]);
    const worldPerT = Math.hypot(fragWorld[0] - rel[0], fragWorld[1] - rel[1], fragWorld[2] - rel[2]);
    column += cpuRaymarchColumn(cam, frag, worldPerT, comp, undefined, omegaPx);
  }
  return columnSurfaceBrightness(column);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function meshRadiusPc(o: BuildLgObject): number {
  return Math.max(...emissionComponents(o.emission).flatMap((c) => c.axesPc));
}

/** The peak a phase scan alone finds — the shipped provider without its cusp
 *  phase, rebuilt here so the test can show what that phase is worth. */
function scanOnlyPeakColumn(
  comp: ReturnType<typeof emissionComponents>[number],
  cam: Vec3,
  o: BuildLgObject,
  omegaPx: number,
  phases: number,
): number {
  const rel: Vec3 = [cam[0] - o.center[0], cam[1] - o.center[1], cam[2] - o.center[2]];
  const camLocal = quatUnrotate(o.quat, rel)
    .map((v, i) => v / comp.axesPc[i]) as [number, number, number];
  const n = Math.hypot(camLocal[0], camLocal[1], camLocal[2]);
  const fragWorld = quatRotate(o.quat, [
    (-camLocal[0] / n) * comp.axesPc[0],
    (-camLocal[1] / n) * comp.axesPc[1],
    (-camLocal[2] / n) * comp.axesPc[2],
  ]);
  const worldPerT = Math.hypot(fragWorld[0] - rel[0], fragWorld[1] - rel[1], fragWorld[2] - rel[2]);
  let peak = 0;
  for (let k = 0; k < phases; k++) {
    const column = centralRayColumnAtPhase(camLocal, worldPerT, comp, omegaPx, k / phases);
    if (column > peak) peak = column;
  }
  return peak;
}

function camerasFor(o: BuildLgObject): Vec3[] {
  const r = meshRadiusPc(o);
  const c = o.center;
  return [SOL, [c[0] + 8 * r, c[1], c[2]], [c[0], c[1] + 2 * r, c[2] + 2 * r]];
}

describe('the bound against the shader', () => {
  // Phase 0.5 is one of the scan's own samples, so this cannot fail on the
  // bounding: it is the agreement check between centralRayColumnAtPhase and
  // cpuRaymarchColumn, which reach the same ray by different routes — one from
  // the camera through the centre, one by ray-sphere intersection through a
  // point. The bounding itself is the phase-density test below.
  it('reproduces the established mirror at the midpoint phase', () => {
    let worst = Number.NEGATIVE_INFINITY;
    for (const o of FIVE) {
      for (const cam of camerasFor(o)) {
        for (const omega of [OMEGA_PX_10DEG, OMEGA_PX_50DEG, OMEGA_PX_120DEG]) {
          const bound = objectPeakSurfaceBrightness(asSource(o), cam, omega);
          worst = Math.max(worst, bound - shaderRaySb(o, cam, o.center, omega));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  // The shader's hash is continuous in [0, 1) while the shipped scan samples
  // 16 points of it, so "max over the phases we sampled" bounds the pixel only
  // if nothing sharper hides between them. Checked against a 256× denser
  // sweep — the property the bound rests on, and the one the midpoint test
  // above structurally cannot fail on.
  it('loses nothing to a 256x denser phase sweep', () => {
    let worstShortfallMag = 0;
    for (const o of FIVE) {
      for (const cam of camerasFor(o)) {
        for (const omega of [OMEGA_PX_10DEG, OMEGA_PX_50DEG, OMEGA_PX_120DEG]) {
          for (const comp of emissionComponents(o.emission)) {
            const shipped = componentPeakColumn(comp, cam, o.center, o.quat, omega);
            const dense = componentPeakColumn(
              comp, cam, o.center, o.quat, omega, LG_PEAK_JITTER_PHASES * 256,
            );
            worstShortfallMag = Math.max(worstShortfallMag, -2.5 * Math.log10(shipped / dense));
          }
        }
      }
    }
    expect(worstShortfallMag).toBeLessThanOrEqual(1e-4);
  });

  // The cusp is what a scan misses, so removing it has to hurt — otherwise
  // the test above is passing on the scan alone and proves nothing about the
  // mechanism the bound relies on. M31's bulge from 2.8 mesh radii at 10° is
  // the sharpest case on the grid.
  it('the cusp phase is load-bearing — a scan alone understates it by 0.46 mag', () => {
    const m31 = buildObject('M31');
    const cam = camerasFor(m31)[2];
    const bulge = emissionComponents(m31.emission).find((c) => c.family === 'sersic')!;
    const dense = componentPeakColumn(
      bulge, cam, m31.center, m31.quat, OMEGA_PX_10DEG, LG_PEAK_JITTER_PHASES * 256,
    );
    const scanOnly = scanOnlyPeakColumn(bulge, cam, m31, OMEGA_PX_10DEG, 64);
    expect(-2.5 * Math.log10(scanOnly / dense)).toBeCloseTo(0.4585, 3);
  });

  // Rays through neighbouring pixels see the profile pointwise dimmer, so
  // the centre ray's phase maximum bounds them too — checked rather than
  // argued, one pixel out in eight directions at the acceptance plate scale.
  it('contains off-centre rays one pixel from the nucleus', () => {
    for (const o of FIVE) {
      for (const cam of camerasFor(o)) {
        const d = distance(cam, o.center);
        const pxPc = d / PX_PER_RAD_50;
        const bound = objectPeakSurfaceBrightness(asSource(o), cam, OMEGA_PX_50DEG);
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * 2 * Math.PI;
          const point: Vec3 = [
            o.center[0] + pxPc * Math.cos(ang),
            o.center[1] + pxPc * Math.sin(ang),
            o.center[2] + pxPc * Math.sin(ang) * Math.cos(ang),
          ];
          expect(bound).toBeLessThanOrEqual(shaderRaySb(o, cam, point, OMEGA_PX_50DEG));
        }
      }
    }
  });

  it('the phase maximum exceeds the midpoint phase by 0.83 mag on the M31 bulge from 8 mesh radii', () => {
    const m31 = buildObject('M31');
    const cam = camerasFor(m31)[1];
    const bulge = emissionComponents(m31.emission).find((c) => c.family === 'sersic')!;
    const rel: Vec3 = [cam[0] - m31.center[0], cam[1] - m31.center[1], cam[2] - m31.center[2]];
    const camLocal = quatUnrotate(m31.quat, rel).map((v, i) => v / bulge.axesPc[i]) as [number, number, number];
    const worldPerT = distance(cam, m31.center) + bulge.axesPc[0];
    const midpoint = centralRayColumnAtPhase(camLocal, worldPerT, bulge, OMEGA_PX_10DEG, 0.5);
    const peak = componentPeakColumn(bulge, cam, m31.center, m31.quat, OMEGA_PX_10DEG);
    expect(-2.5 * Math.log10(peak / midpoint)).toBeCloseTo(-0.83, 2);
  });
});

describe('from Sol at the acceptance plate scale', () => {
  // 0.2 mag under the default view's threshold (docs/science-hdr-pipeline.md
  // § 3.5: 17.21 at the −6.29 floor cut), so the glow can skip there.
  it('M31 peaks at 17.42 mag/arcsec²', () => {
    const sb = objectPeakSurfaceBrightness(asSource(buildObject('M31')), SOL, OMEGA_PX_50DEG);
    expect(sb).toBeCloseTo(17.42, 2);
  });

  it('the layer peak is M31', () => {
    const sources = ALL_OBJECTS.map(asSource);
    expect(lgPeakSurfaceBrightness(sources, SOL, OMEGA_PX_50DEG)).toBe(
      objectPeakSurfaceBrightness(asSource(buildObject('M31')), SOL, OMEGA_PX_50DEG),
    );
  });
});

describe('the sub-pixel expansion only lowers the peak', () => {
  it('leaves an expanded component fainter at every phase', () => {
    const fornax = buildObject('Fornax');
    const cam = camerasFor(fornax)[1];
    for (const comp of emissionComponents(fornax.emission)) {
      const plain = componentPeakColumn(comp, cam, fornax.center, fornax.quat, OMEGA_PX_50DEG);
      const grown = componentPeakColumn(
        expandComponent(comp, 4), cam, fornax.center, fornax.quat, OMEGA_PX_50DEG,
      );
      expect(grown).toBeLessThan(plain);
    }
  });
});

describe('LgPeakCache', () => {
  const sources = FIVE.map(asSource);

  it('holds inside the recompute radius, refreshes past it and on a plate-scale change', () => {
    const cache = new LgPeakCache();
    const first = cache.peakAt(sources, SOL, OMEGA_PX_50DEG);
    expect(first).toBe(lgPeakSurfaceBrightness(sources, SOL, OMEGA_PX_50DEG));
    const inside: Vec3 = [0, 0, LG_PEAK_RECOMPUTE_PC * 0.9];
    expect(cache.peakAt(sources, inside, OMEGA_PX_50DEG)).toBe(first);
    const outside: Vec3 = [0, 0, LG_PEAK_RECOMPUTE_PC * 1.1];
    expect(cache.peakAt(sources, outside, OMEGA_PX_50DEG)).toBe(
      lgPeakSurfaceBrightness(sources, outside, OMEGA_PX_50DEG),
    );
    expect(cache.peakAt(sources, outside, OMEGA_PX_10DEG)).toBe(
      lgPeakSurfaceBrightness(sources, outside, OMEGA_PX_10DEG),
    );
  });

  it('reset fails the next read back to a recompute', () => {
    const cache = new LgPeakCache();
    cache.peakAt(sources, SOL, OMEGA_PX_50DEG);
    cache.reset();
    expect(cache.peakAt(sources, SOL, OMEGA_PX_120DEG)).toBe(
      lgPeakSurfaceBrightness(sources, SOL, OMEGA_PX_120DEG),
    );
  });
});
