import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CAMERA_NEAR_PC, FOV_MAX_DEG } from './timing';
import { CAMERA_FAR_PC, MAX_DISTANCE_PC } from '../../../scripts/local-group/build-local-group-pure';
import { GLOBAL_MIN_DIST_PC } from './focus/focus-controller';
import {
  fovMinorRad,
  minOrbitDistForPlanet,
} from './controls/star-physics';
import {
  PROBE_ORBIT_FLOOR_PC,
  PROBE_PARK_DIST_PC,
} from '../solar-system/probes/probe-focus-geometry';
import { DEFAULT_FOV } from '../filters/filter-state';
import { SOL_BODIES } from '../solar-system/planet-system';
import { KM_PC } from '../util/astronomy-constants';

// The near/far pair is a configuration invariant, not a formula: it holds
// because every reachable orbit distance sits inside it. Nothing rendered
// it enforceable before this file, so a near-plane edit could only be
// caught by noticing bodies vanish at max zoom in the browser.
describe('camera depth range / near-plane configuration', () => {
  it('pins the shipped near plane', () => {
    // A wider near plane is the specific regression: 1e-10 pc clipped
    // every sub-Pluto moon at its park distance, and the pre-log-depth
    // 1e-3 pc clipped anything closer than the unfocused orbit floor.
    expect(CAMERA_NEAR_PC).toBe(1e-12);
  });

  it('sits below the unfocused orbit floor', () => {
    expect(CAMERA_NEAR_PC).toBeLessThan(GLOBAL_MIN_DIST_PC);
  });

  // A wider FOV lowers the floor until the surface clamp binds at fovMinor
  // 96.895°, so FOV_MAX_DEG is still the worst case but the clamp — not the
  // fill solve — sets it. Aspect enters through fovMinor = min(fovX, fovY),
  // and a landscape viewport leaves fovMinor = fovY, so a square-ish aspect
  // is the tightest realistic configuration.
  function tightestZoomFloorPc(fovDeg: number): number {
    const camera = new THREE.PerspectiveCamera(fovDeg, 1, CAMERA_NEAR_PC, CAMERA_FAR_PC);
    const fovMinor = fovMinorRad(camera);
    return Math.min(
      ...SOL_BODIES.map((b) => minOrbitDistForPlanet(b.radiusKm * KM_PC, fovMinor)),
    );
  }

  it('sits below the manual-zoom floor of every Sol body at the widest FOV', () => {
    expect(CAMERA_NEAR_PC).toBeLessThan(tightestZoomFloorPc(FOV_MAX_DEG));
  });

  it('pins the smallest-moon margin exactly — the clamp made it FOV-invariant', () => {
    // The margin is the whole reason the near plane sits at 1e-12 rather than
    // 1e-10, and it is NOT comfortable. Adding a moon roughly 6× smaller than
    // Mimas (R ≈ 198 km, the smallest body in SOL_BODIES) — or dropping the
    // surface clamp — puts a focused body ON the clip plane, where it vanishes
    // at max zoom. Pinned so that change fails here instead of in the browser.
    const marginAtWidest = tightestZoomFloorPc(FOV_MAX_DEG) / CAMERA_NEAR_PC;
    expect(marginAtWidest).toBeCloseTo(6.7444, 4);
    // At the default FOV the fill solve still binds and the same body sits
    // ~15.5× up.
    expect(tightestZoomFloorPc(DEFAULT_FOV) / CAMERA_NEAR_PC).toBeGreaterThan(15);
  });

  it('keeps the probe orbit floor clear of the near plane, park above it', () => {
    // The probe pair is FOV-independent (a fixed-pixel marker has no disc
    // to fill), so one margin covers every FOV — unlike the body floors
    // above, whose worst case is FOV_MAX_DEG. A metre-scale solve on the
    // spacecraft hull is what this replaces: it would land ~1e-17 pc,
    // five orders of magnitude inside the clip plane.
    expect(PROBE_ORBIT_FLOOR_PC / CAMERA_NEAR_PC).toBeGreaterThan(30);
    expect(PROBE_PARK_DIST_PC).toBeGreaterThan(PROBE_ORBIT_FLOOR_PC);
  });

  it('covers the whole catalog out to the far plane', () => {
    // The build filter drops Local Group objects past MAX_DISTANCE_PC, so
    // a far plane at or below it would clip the outermost rows the build
    // deliberately kept.
    expect(CAMERA_FAR_PC).toBeGreaterThan(MAX_DISTANCE_PC);
  });

  it('spans the range that requires a logarithmic depth buffer', () => {
    // 18 orders of magnitude between the planes. A standard [0,1] depth
    // encoding puts essentially all of its float32 resolution in the first
    // fraction of that span, which is why `logarithmicDepthBuffer: true`
    // on the renderer is not optional at this configuration. Pinning the
    // decade count keeps a near/far edit from quietly moving the range
    // into (or out of) the regime the flag exists for.
    const decades = Math.log10(CAMERA_FAR_PC / CAMERA_NEAR_PC);
    expect(Math.round(decades)).toBe(18);
  });
});
