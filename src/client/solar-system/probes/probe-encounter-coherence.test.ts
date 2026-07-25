// Coherence corpus for the committed probe trajectories: sampled position
// vs the planet ephemeris at each closest approach, and vs the heliopause
// boundary at the Voyager crossings. README.md § Coherence, not precision.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AU_PER_PC } from '../../util/astronomy-constants';
import { getPlanetPositions, _resetCacheForTests, type PlanetName } from '../ephemerides/ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from '../ephemerides/orbit-rings-layer';
import { HELIOPAUSE_APEX_SOL_PC } from '../heliopause/heliopause';
import { probeTrajectoryFilename } from '../../../../scripts/probes/sync-probes-pure';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import {
  buildProbeTrajectory,
  probeStateAt,
  type ProbeState,
  type ProbeTrajectory,
} from './probe-trajectory';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(__dirname, '../../../../data/probes');

// The same quaternion construction planet-body-field.attachHost and
// OrbitRingsLayer build for Sol. The probe samples are already ICRS
// (REF_PLANE=FRAME); the ephemeris is heliocentric ECLIPTIC, so it is the
// planet side that rotates. Skipping the rotation misses by tens of AU at
// the outer-planet encounters — the frame trap this corpus exists to catch.
const ECL_TO_ICRS = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS.clone(),
);

// Closest-approach tolerance, AU. Dominated by linear interpolation across
// the 30-day sampling: a probe at Jupiter moves ~10 km/s relative to the
// planet, and the chord across a curving flyby cuts the corner by a few
// tenths of an AU. This is a COHERENCE bound (right probe, right planet,
// right frame, right units) — a frame or unit error blows it by tens of
// AU. Do not tighten it into a precision claim; the data is a 30-day
// visualisation, not an ephemeris (data/probes/README.md § Schema).
const ENCOUNTER_TOLERANCE_AU = 0.5;

interface Encounter {
  probe: string;
  planet: PlanetName;
  utc: string;
}

// Epochs from each probe's Horizons header TIMELINE block.
const ENCOUNTERS: readonly Encounter[] = [
  { probe: 'pioneer10', planet: 'jupiter', utc: '1973-12-04T00:00:00Z' },
  { probe: 'pioneer11', planet: 'jupiter', utc: '1974-12-03T00:00:00Z' },
  { probe: 'pioneer11', planet: 'saturn', utc: '1979-09-01T00:00:00Z' },
  { probe: 'voyager1', planet: 'jupiter', utc: '1979-03-05T00:00:00Z' },
  { probe: 'voyager1', planet: 'saturn', utc: '1980-11-12T00:00:00Z' },
  { probe: 'voyager2', planet: 'jupiter', utc: '1979-07-09T00:00:00Z' },
  { probe: 'voyager2', planet: 'saturn', utc: '1981-08-25T00:00:00Z' },
  { probe: 'voyager2', planet: 'uranus', utc: '1986-01-24T00:00:00Z' },
  { probe: 'voyager2', planet: 'neptune', utc: '1989-08-25T00:00:00Z' },
  { probe: 'newhorizons', planet: 'pluto', utc: '2015-07-14T00:00:00Z' },
];

// Heliopause crossing epochs (Gurnett & Kurth 2013 / 2019) with the
// heliocentric distance and off-nose angle measured from the committed
// trajectories. These are the two observations the shell's 122 AU upwind
// and ~115 AU flank were derived from (heliopause/README.md § Geometry).
const CROSSINGS = [
  { probe: 'voyager1', utc: '2012-08-25T00:00:00Z', distanceAu: 121.60, offNoseDeg: 29.86 },
  { probe: 'voyager2', utc: '2018-11-05T00:00:00Z', distanceAu: 119.02, offNoseDeg: 52.56 },
] as const;

function loadProbe(id: string): ProbeTrajectory {
  const raw = readFileSync(resolve(PROBE_DIR, probeTrajectoryFilename(id)), 'utf-8');
  return buildProbeTrajectory(JSON.parse(raw) as ProbeTrajectoryFile);
}

const TRAJECTORIES = new Map<string, ProbeTrajectory>(
  [...new Set([...ENCOUNTERS.map((e) => e.probe), ...CROSSINGS.map((c) => c.probe)])]
    .map((id) => [id, loadProbe(id)]),
);

const state: ProbeState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/** Heliocentric ICRS probe position (pc) at `utc`. */
function probePositionAt(id: string, utc: string): THREE.Vector3 {
  const traj = TRAJECTORIES.get(id)!;
  const found = probeStateAt(traj, Date.parse(utc) / 1000, state);
  expect(found).toBe(true);
  return new THREE.Vector3(state.x, state.y, state.z);
}

/** Heliocentric ICRS planet position (pc) at `utc`, through the production
 *  ephemeris → ecliptic→ICRS chain. */
function planetPositionAt(planet: PlanetName, utc: string): THREE.Vector3 {
  _resetCacheForTests();
  const p = getPlanetPositions(Date.parse(utc) / 1000)[planet];
  return new THREE.Vector3(p.x, p.y, p.z).applyQuaternion(ECL_TO_ICRS);
}

describe('probe planet encounters', () => {
  for (const { probe, planet, utc } of ENCOUNTERS) {
    it(`${probe} is at ${planet} on ${utc.slice(0, 10)}`, () => {
      const missAu = probePositionAt(probe, utc)
        .sub(planetPositionAt(planet, utc)).length() * AU_PER_PC;
      expect(missAu).toBeLessThan(ENCOUNTER_TOLERANCE_AU);
    });
  }

  it('fails by tens of AU if the ephemeris frame rotation is skipped', () => {
    // Guards the tolerance above: it must be tight enough that the
    // ecliptic-vs-ICRS trap can't slip through unnoticed.
    _resetCacheForTests();
    const utc = '1989-08-25T00:00:00Z';
    const unrotated = getPlanetPositions(Date.parse(utc) / 1000).neptune;
    const missAu = probePositionAt('voyager2', utc)
      .sub(new THREE.Vector3(unrotated.x, unrotated.y, unrotated.z))
      .length() * AU_PER_PC;
    expect(missAu).toBeGreaterThan(10);
  });
});

describe('heliopause crossings', () => {
  const apexDir = HELIOPAUSE_APEX_SOL_PC.clone().normalize();

  for (const { probe, utc, distanceAu, offNoseDeg } of CROSSINGS) {
    it(`${probe} crosses at ${distanceAu} AU, ${offNoseDeg}° off the nose`, () => {
      const pos = probePositionAt(probe, utc);
      expect(pos.length() * AU_PER_PC).toBeCloseTo(distanceAu, 1);
      const offNose = THREE.MathUtils.radToDeg(pos.clone().normalize().angleTo(apexDir));
      expect(offNose).toBeCloseTo(offNoseDeg, 1);
    });
  }

  it('brackets both crossings between the shell flank and upwind apex', () => {
    // The shell's semi-equatorial 115 AU and upwind 122 AU were derived
    // FROM these two crossings; the trajectories have to land back inside
    // that range or the shell no longer describes the same heliosphere.
    for (const { probe, utc } of CROSSINGS) {
      const rAu = probePositionAt(probe, utc).length() * AU_PER_PC;
      expect(rAu).toBeGreaterThan(115);
      expect(rAu).toBeLessThan(122);
    }
  });
});
