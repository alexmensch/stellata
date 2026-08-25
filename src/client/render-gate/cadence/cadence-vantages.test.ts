// The cadence's pinned acceptance vantages — README.md § Pinned vantages
// carries the arithmetic each number comes out of.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PlanetBodyField } from '../../solar-system/planets/planet-body-field';
import { SOL_BODIES, getPlanetSystem } from '../../solar-system/planet-system';
import { KM_PC, R_SUN_PC, SUN_ABSMAG_V } from '../../util/astronomy-constants';
import { makeCadenceCtx, ACCEPTANCE_PX_PER_RADIAN } from '../../scene/frame-ctx-mock';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  CADENCE_REPORT_STILL,
  cadenceSimBudgetS,
  clockFrameDue,
} from './clock-cadence-pure';
import type {
  ChartDiscUniforms,
  PerceptualDiscUniforms,
} from '../../star-pipeline/perceptual-disc/perceptual-disc-uniforms';
import { makeHdrEmitterUniforms, type HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { DEFAULT_FILTER, instrumentLimitMag } from '../../filters/filter-state';
import { cullMagFor } from '../../hdr/exposure/exposure-epoch';

/** The one plate scale every number here is quoted against: 900 CSS px of
 *  viewport height at the default 50 deg vertical FOV, 16:9, on a
 *  ratio-2 display. */
const VIEWPORT_H = 900;
const FOV_Y_DEG = 50;
const ASPECT = 16 / 9;
const PIXEL_RATIO = 2;
const LIMIT_MAG = instrumentLimitMag(DEFAULT_FILTER.instrument);
/** 2026-01-01T00:00:00Z. Any epoch works — the rates are geometric — but
 *  a fixed one keeps the pinned values reproducible. */
const T0 = Date.UTC(2026, 0, 1) / 1000;
/** One rendered frame's worth of sim time at live rate. */
const DT = 1;

function makeUniforms(): PerceptualDiscUniforms & ChartDiscUniforms & HdrEmitterUniforms {
  return {
    ...makeHdrEmitterUniforms(),
    uMonochrome: { value: 0 },
    uChartDiscMaxPx: { value: 28 },
    uChartDiscMinPx: { value: 1.5 },
    uChartMagBright: { value: -2 },
    uLimitMag: { value: LIMIT_MAG },
    uThresholdMag: { value: LIMIT_MAG },
    uCullMag: { value: cullMagFor(LIMIT_MAG) },
    uSizeMin: { value: 2 },
    uSizeMax: { value: 24 },
    uSizeSpan: { value: 8 },
    uSizeKnee: { value: 16 },
    uVisibleThreshold: { value: 0.2 },
    uVisibleK: { value: -Math.log(0.2) },
    uCoreThreshold: { value: 0.4 },
    uDiscardThreshold: { value: 0.02 },
    uDistNMin: { value: 2.2 },
    uDistNMax: { value: 10.0 },
    uLumBiasMin: { value: 1.0 },
    uLumBiasMax: { value: 0.6 },
    uViewport: { value: new THREE.Vector2(VIEWPORT_H * ASPECT, VIEWPORT_H) },
    uPixelRatio: { value: PIXEL_RATIO },
    uFovYRad: { value: (FOV_Y_DEG * Math.PI) / 180 },
  };
}

const bodyIdx = (name: string): number => {
  const i = SOL_BODIES.findIndex((b) => b.name === name);
  if (i < 0) throw new Error(`no body named ${name}`);
  return i;
};

/** Sol's real system attached, walked once at `T0 - DT` and once at `T0`,
 *  so the field holds a genuine one-frame position difference. Returns the
 *  field plus each named body's position at both epochs. */
async function solAtT0(names: readonly string[]) {
  const field = new PlanetBodyField(makeUniforms());
  const ps = await getPlanetSystem(0, 0);
  const camera = new THREE.PerspectiveCamera(FOV_Y_DEG, ASPECT, 1e-12, 1e6);
  field.attachHost(0, ps!, SUN_ABSMAG_V, R_SUN_PC, new THREE.Vector3(), 0, T0 - DT);
  field.update(camera, T0 - DT, 0);
  const prev = new Map<string, THREE.Vector3>();
  for (const n of names) {
    const v = new THREE.Vector3();
    field.planetLocalPositionInto(bodyIdx(n), v);
    prev.set(n, v);
  }
  field.update(camera, T0, 16);
  const now = new Map<string, THREE.Vector3>();
  for (const n of names) {
    const v = new THREE.Vector3();
    field.planetLocalPositionInto(bodyIdx(n), v);
    now.set(n, v);
  }
  return { field, camera, prev, now };
}

/** The camera velocity the focal ride applies while riding `name`: exactly
 *  that body's own displacement over the same sim step, which is why the
 *  ridden body's translation term cancels to zero rather than to
 *  "something small". */
function rideVelocity(
  prev: Map<string, THREE.Vector3>,
  now: Map<string, THREE.Vector3>,
  name: string,
): THREE.Vector3 {
  return now.get(name)!.clone().sub(prev.get(name)!).divideScalar(DT);
}

const budgetOf = (report: Parameters<typeof cadenceSimBudgetS>[0]): number =>
  cadenceSimBudgetS(report, Number.POSITIVE_INFINITY, PIXEL_RATIO);

describe('cadence vantage 1 — the default Sol view, live 1x', () => {
  it('the plate scale every pinned number is quoted against', () => {
    expect(ACCEPTANCE_PX_PER_RADIAN).toBeCloseTo(1031.324, 3);
  });

  it('no planet body puts ink on screen from 30 pc, so nothing is reported', async () => {
    const { field, camera, now } = await solAtT0(['Earth']);
    camera.position.set(30, 0, 0);
    camera.lookAt(now.get('Earth')!);
    camera.updateMatrixWorld();
    expect(field.cadenceReport(makeCadenceCtx(camera, { simDtS: DT })))
      .toEqual(CADENCE_REPORT_STILL);
    field.dispose();
  });

  it('the budget is the cap, 30 sim-s — one frame per 30 real seconds', () => {
    expect(budgetOf(CADENCE_REPORT_STILL)).toBe(CADENCE_CAP_SIM_S);
    expect(clockFrameDue(1, T0 + 29.9, T0, CADENCE_CAP_SIM_S)).toBe(false);
    expect(clockFrameDue(1, T0 + 30, T0, CADENCE_CAP_SIM_S)).toBe(true);
  });
});

describe('cadence vantage 2 — focused Earth at closest approach', () => {
  /** 15 800 km from Earth's centre: the closest the focus park allows. */
  const D_KM = 15_800;

  async function earthVantage() {
    const { field, camera, prev, now } = await solAtT0(['Earth', 'Moon']);
    const earth = now.get('Earth')!;
    // Radially outward from Sol, so Earth is fully lit and fully resolved.
    const out = earth.clone().normalize().multiplyScalar(D_KM * KM_PC);
    camera.position.copy(earth).add(out);
    camera.lookAt(earth);
    camera.updateMatrixWorld();
    const ctx = makeCadenceCtx(camera, {
      simDtS: DT,
      cameraVelPcPerSimS: rideVelocity(prev, now, 'Earth'),
    });
    return { field, report: field.cadenceReport(ctx) };
  }

  it('the ridden focal contributes NO translation — only its own rotation', async () => {
    const { field, report } = await earthVantage();
    // omega·atan(R/d)·pxPerRadian for Earth alone: 7.29212e-5 rad/s over an
    // angular radius of atan(6371/15800) = 0.383518 rad.
    const earthSpin = 7.292115e-5 * Math.atan(6371 / D_KM) * ACCEPTANCE_PX_PER_RADIAN;
    expect(report.screenPxPerSimS).toBeCloseTo(earthSpin, 4);
    field.dispose();
  });

  it('the frame budget is seconds, not the 0.038 s the population bound gave', async () => {
    const { field, report } = await earthVantage();
    const budget = budgetOf(report);
    expect(budget).toBeCloseTo(4.335, 2);
    // The mandate quotes 4.9-8.3 s for this vantage. That band is the same
    // physics at the un-halved threshold (8.67 s here) with a small-angle
    // disc radius R/d in place of atan(R/d); the shipped number is half of
    // it by the safety factor, and 114x what #408 computed.
    expect(budget * 2).toBeCloseTo(8.67, 2);
    expect(clockFrameDue(1, T0 + 4, T0, budget)).toBe(false);
    field.dispose();
  });

  it('nothing else in the system outruns Earth from there', async () => {
    const { field, report } = await earthVantage();
    // The Moon rides along at ~1 km/s over 384 400 km and Sol's own
    // parallax is 30 km/s over 1 AU; both are an order under Earth's spin.
    expect(report.screenPxPerSimS).toBeLessThan(0.03);
    expect(report.observedPx).toBeLessThan(0.01);
    field.dispose();
  });
});

describe('cadence vantage 3 — focused Io at 3 000 km, Jupiter entering the view', () => {
  const D_KM = 3_000;

  async function ioVantage(lookAtName: string) {
    const { field, camera, prev, now } = await solAtT0(['Io', 'Jupiter']);
    const io = now.get('Io')!;
    const jup = now.get('Jupiter')!;
    // Camera between Jupiter and Io, so looking at Io points AWAY from
    // Jupiter: Jupiter is behind the camera and enters the view only when
    // the camera turns round.
    const out = jup.clone().sub(io).normalize().multiplyScalar(D_KM * KM_PC);
    camera.position.copy(io).add(out);
    camera.lookAt(now.get(lookAtName)!);
    camera.updateMatrixWorld();
    const ctx = makeCadenceCtx(camera, {
      simDtS: DT,
      cameraVelPcPerSimS: rideVelocity(prev, now, 'Io'),
    });
    return { field, report: field.cadenceReport(ctx) };
  }

  it('looking at Io, only Io is on screen and only its rotation counts', async () => {
    const { field, report } = await ioVantage('Io');
    const ioSpin = 4.10958e-5 * Math.atan(1821.6 / D_KM) * ACCEPTANCE_PX_PER_RADIAN;
    expect(report.screenPxPerSimS).toBeCloseTo(ioSpin, 4);
    expect(budgetOf(report)).toBeCloseTo(5.404, 2);
    field.dispose();
  });

  it('turning toward Jupiter brings its parallax in and the budget falls', async () => {
    const { field, report } = await ioVantage('Jupiter');
    const budget = budgetOf(report);
    // Jupiter's two terms ADD: its parallax as Io carries the camera round
    // it (17.33 km/s over 421 700 km) plus its own 9.925 h rotation across
    // its angular radius. The mandate's example took the min of the two,
    // which under-counts a feature on the limb carrying both.
    expect(budget).toBeCloseTo(1.717, 2);
    expect(budget).toBeLessThan(5.404);
    field.dispose();
  });

  it('the rise and fall is driven by what is in the view, nothing else', async () => {
    const io = await ioVantage('Io');
    const jup = await ioVantage('Jupiter');
    // Same instant, same camera position, same clock: only the direction
    // the camera points differs.
    expect(jup.report.screenPxPerSimS).toBeGreaterThan(io.report.screenPxPerSimS);
    io.field.dispose();
    jup.field.dispose();
  });
});

describe('cadence vantage 4 — emerging from behind the parent', () => {
  // Io behind Jupiter. While Io is hidden it reports nothing, so the step
  // it takes before the next frame is unbudgeted; the cap and the occluder's
  // own rotation are what cover it (README.md § Emerging from behind
  // something).
  const V_IO_KM_S = 17.334;
  const JUPITER_OMEGA = 1.758533e-4;
  const JUPITER_R_KM = 71_492;

  it('the emergence error is scale-free — d and the plate scale cancel', () => {
    // budget = thresh / (omega·R/d · pxPerRad · ratio) and the error in
    // device px is v·budget/d · pxPerRad · ratio, so both drop out.
    const errorDevicePx = (CADENCE_MOTION_THRESHOLD_DEVICE_PX * V_IO_KM_S)
      / (JUPITER_OMEGA * JUPITER_R_KM);
    expect(errorDevicePx).toBeCloseTo(0.3447, 4);
    for (const dKm of [1e5, 1e6, 1e7, 1e9]) {
      const budget = CADENCE_MOTION_THRESHOLD_DEVICE_PX
        / ((JUPITER_OMEGA * JUPITER_R_KM / dKm) * ACCEPTANCE_PX_PER_RADIAN * PIXEL_RATIO);
      const err = (V_IO_KM_S * budget / dKm) * ACCEPTANCE_PX_PER_RADIAN * PIXEL_RATIO;
      expect(err).toBeCloseTo(errorDevicePx, 8);
    }
  });

  it('and it lands under the step a viewer can see, at every distance', () => {
    const errorDevicePx = (CADENCE_MOTION_THRESHOLD_DEVICE_PX * V_IO_KM_S)
      / (JUPITER_OMEGA * JUPITER_R_KM);
    // The comparison is against the VISIBLE step, not the scheduling
    // threshold — the safety factor is exactly the margin this spends.
    expect(errorDevicePx / (2 * CADENCE_MOTION_THRESHOLD_DEVICE_PX)).toBeCloseTo(0.689, 3);
  });

  it('close in, the true angular radius makes it worse by a bounded factor', () => {
    // atan(R/d) < R/d, so the budget is longer than the small-angle form
    // by d·atan(R/d)/R. At two Jupiter radii — closer than any emergence
    // the model can show — that is 8%.
    const factor = (d: number) => (d * Math.atan(JUPITER_R_KM / d)) / JUPITER_R_KM;
    expect(factor(2 * JUPITER_R_KM)).toBeCloseTo(0.9273, 4);
    expect(factor(1e7)).toBeCloseTo(1, 4);
  });
});
