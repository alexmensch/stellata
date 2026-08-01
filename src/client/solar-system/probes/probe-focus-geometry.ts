// Camera park distance and manual-zoom floor for a focused deep-space
// probe. See README.md § Park distance.

import { KM_PC } from '../../util/astronomy-constants';

// Fixed distances rather than the fill-fraction solve every other kind
// uses: a probe renders as a fixed-pixel marker with no angular diameter
// to fill, and its own metre-scale hull would solve to a park far INSIDE
// `CAMERA_NEAR_PC` (~31 km), clipping the very marker the camera flew to.
// The pair is therefore set by the near plane at one end and by "still
// riding with the probe" at the other — 1000 km sits ~32× above the near
// plane (the smallest moon's floor sits 4.7× above it at the widest FOV),
// and 10 000 km is under 2 % of Voyager 2's 570 000 km Jupiter closest
// approach, so the encounter geometry the flythrough shows is the probe's
// own.
export const PROBE_ORBIT_FLOOR_PC = 1_000 * KM_PC;
export const PROBE_PARK_DIST_PC = 10_000 * KM_PC;
