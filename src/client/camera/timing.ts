// Camera-wide timing constants, angular bounds, and numeric floors.
// Single source of truth for every constant listed in
// src/client/camera/README.md § Shared.

import * as THREE from 'three';

// Canonical 2 s duration for non-warp camera lerps — focus-park glide
// and the aim-animation upper bound. (`WARP_REORIENT_MS` was once part
// of this family but tuning moved it off the literal; the warp's
// reorient phase reads slightly snappier than a generic camera glide.)
export const CAMERA_LERP_MS = 2000;

export const WARP_T_MIN_MS = 3000;
export const WARP_T_MAX_MS = 20000;
export const WARP_T_K_MS = 3000;
export const WARP_REORIENT_MS = 1800;
export const FOCUS_LERP_MS = CAMERA_LERP_MS;

// Aim animation: rotate the camera around `controls.target` so a chosen
// world point lands at the centre of the view. Capped at 2 s so even a
// 180° swing stays snappy; floored at 250 ms so trivial nudges still ease.
export const AIM_T_MAX_MS = CAMERA_LERP_MS;
export const AIM_T_MIN_MS = 250;

// OBSERVE-mode entry/exit translate animation. Travel distance is always
// parkDistForStar (sub-parsec) so a fixed duration reads as a brief glide
// rather than a warp.
export const OBSERVE_TRANSITION_MS = 1800;

// Vertical-FOV bounds in degrees. The OBSERVE wheel-zoom clamps to this
// range, and it is the widest FOV any entry point can produce — the URL
// blob quantises its `fov` field over the same interval (that field table
// is frozen per schema version, so it carries the bounds as literals by
// design and must not be rewired to these constants). A wider FOV lowers
// every angular zoom floor, so `CAMERA_NEAR_PC` is validated against
// `FOV_MAX_DEG`.
export const FOV_MIN_DEG = 10;
export const FOV_MAX_DEG = 120;

// Perspective near plane, in parsecs. Must stay strictly below every
// orbit distance the camera can reach, or a maximally-zoomed-in body
// lands on the clip plane and disappears. The binding floor is a focused
// small moon: minOrbitDistForPlanet(Mimas, R ≈ 198 km) ≈ 1.5e-11 pc — a
// larger 1e-10 pc near plane clipped every sub-Pluto moon at its park
// distance. `logarithmicDepthBuffer` on the renderer is what keeps depth
// precision intact across the resulting near→far range; the pairing is
// load-bearing (controls/README.md § Camera near plane vs controls
// minDistance) and pinned by depth-range.test.ts.
export const CAMERA_NEAR_PC = 1e-12;

// Camera-distance floor used by sites that need a finite log10(dCam) or
// atan(R/dCam) at close approach. 1e-30 pc is well below any orbit the
// camera can actually reach, so it never affects rendering — it just
// keeps Math.log10 / division well-defined at the singular point.
export const DCAM_LOG_FLOOR_PC = 1e-30;

// Arbitrary reference axis for the warp reorient slerp. Any fixed unit
// vector works — `setFromUnitVectors(WARP_BASE_DIR, dir)` produces a
// quaternion rotating this vector to `dir`, and slerp between two such
// quaternions gives the shortest-arc interpolation on the sphere.
export const WARP_BASE_DIR = new THREE.Vector3(0, 0, 1);
