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

// Closest-approach tolerance, AU. Set by the PLANET side: the ephemeris
// series in ../ephemerides/ sits 0.002–0.043 AU off Horizons across these
// epochs (Saturn ~0.025, Uranus ~0.043), while the probe grid holds 1e-5 AU.
// The sampled epochs are also calendar dates rather than the true
// closest-approach instants, which at flyby speeds is another ~0.01 AU.
// This is a COHERENCE bound (right probe, right planet, right frame, right
// units) — a frame or unit error blows it by tens of AU. Tightening it
// further would be a claim about the planet ephemeris, not about probes.
const ENCOUNTER_TOLERANCE_AU = 0.05;

/** What the fetch pipeline built each grid to hold, AU. */
const CHORD_TOLERANCE_AU = 1e-5;

// A swing-by is resolved when no single rendered segment swallows a big
// piece of the turn — the whole point of the non-uniform grid, and the
// thing a uniform 30-day sample cannot do: it renders a 50–220° deflection
// as one or two chords. Measured worst across the nine assists is 13.3°.
const MAX_SEGMENT_TURN_DEG = 20;
const MIN_ASSIST_SAMPLES = 15;
const ASSIST_WINDOW_DAYS = 2;

interface Encounter {
  probe: string;
  planet: PlanetName;
  utc: string;
  /** Whether the pass bent the trajectory. New Horizons' Pluto flyby did
   *  not, and that is why its grid stays coarse there. */
  assist: boolean;
}

// Epochs from each probe's Horizons header TIMELINE block.
const ENCOUNTERS: readonly Encounter[] = [
  { probe: 'pioneer10', planet: 'jupiter', utc: '1973-12-04T00:00:00Z', assist: true },
  { probe: 'pioneer11', planet: 'jupiter', utc: '1974-12-03T00:00:00Z', assist: true },
  { probe: 'pioneer11', planet: 'saturn', utc: '1979-09-01T00:00:00Z', assist: true },
  { probe: 'voyager1', planet: 'jupiter', utc: '1979-03-05T00:00:00Z', assist: true },
  { probe: 'voyager1', planet: 'saturn', utc: '1980-11-12T00:00:00Z', assist: true },
  { probe: 'voyager2', planet: 'jupiter', utc: '1979-07-09T00:00:00Z', assist: true },
  { probe: 'voyager2', planet: 'saturn', utc: '1981-08-25T00:00:00Z', assist: true },
  { probe: 'voyager2', planet: 'uranus', utc: '1986-01-24T00:00:00Z', assist: true },
  { probe: 'voyager2', planet: 'neptune', utc: '1989-08-25T00:00:00Z', assist: true },
  { probe: 'newhorizons', planet: 'pluto', utc: '2015-07-14T00:00:00Z', assist: false },
];

// Heliopause crossing epochs (Gurnett & Kurth 2013 / 2019) with the
// heliocentric distance and off-nose angle measured from the committed
// trajectories. These are the two observations the shell's 122 AU upwind
// and ~115 AU flank were derived from (heliopause/README.md § Geometry).
const CROSSINGS = [
  { probe: 'voyager1', utc: '2012-08-25T00:00:00Z', distanceAu: 121.60, offNoseDeg: 29.86 },
  { probe: 'voyager2', utc: '2018-11-05T00:00:00Z', distanceAu: 119.02, offNoseDeg: 52.56 },
] as const;

const PROBE_IDS = [
  ...new Set([...ENCOUNTERS.map((e) => e.probe), ...CROSSINGS.map((c) => c.probe)]),
];

const FILES = new Map<string, ProbeTrajectoryFile>(
  PROBE_IDS.map((id) => [
    id,
    JSON.parse(
      readFileSync(resolve(PROBE_DIR, probeTrajectoryFilename(id)), 'utf-8'),
    ) as ProbeTrajectoryFile,
  ]),
);

const TRAJECTORIES = new Map<string, ProbeTrajectory>(
  PROBE_IDS.map((id) => [id, buildProbeTrajectory(FILES.get(id)!)]),
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
    // Guards the tolerance above: it must stay tight enough that the
    // ecliptic-vs-ICRS trap can't slip through unnoticed — two hundred
    // times the encounter tolerance, so there is no reading of the data
    // under which the two could be confused.
    _resetCacheForTests();
    const utc = '1989-08-25T00:00:00Z';
    const unrotated = getPlanetPositions(Date.parse(utc) / 1000).neptune;
    const missAu = probePositionAt('voyager2', utc)
      .sub(new THREE.Vector3(unrotated.x, unrotated.y, unrotated.z))
      .length() * AU_PER_PC;
    expect(missAu).toBeGreaterThan(10);
  });
});

/** Angle, degrees, between the two rendered segments meeting at sample `i`. */
function segmentTurnDeg(traj: ProbeTrajectory, i: number): number {
  const p = (k: number): THREE.Vector3 =>
    new THREE.Vector3(traj.posPc[k * 3], traj.posPc[k * 3 + 1], traj.posPc[k * 3 + 2]);
  const here = p(i);
  const incoming = here.clone().sub(p(i - 1));
  const outgoing = p(i + 1).sub(here);
  if (incoming.lengthSq() === 0 || outgoing.lengthSq() === 0) return 0;
  return THREE.MathUtils.radToDeg(incoming.angleTo(outgoing));
}

/** Indices of the samples strictly inside `days` of `utc`. */
function samplesNear(traj: ProbeTrajectory, utc: string, days: number): number[] {
  const t = Date.parse(utc) / 1000;
  const half = days * 86400;
  const found: number[] = [];
  for (let i = 1; i < traj.sampleT.length - 1; i++) {
    if (Math.abs(traj.sampleT[i] - t) < half) found.push(i);
  }
  return found;
}

describe('adaptive sample grid', () => {
  for (const id of PROBE_IDS) {
    it(`${id} spaces samples by how hard the trajectory turns`, () => {
      expect(FILES.get(id)!.chordToleranceAu).toBe(CHORD_TOLERANCE_AU);
      const { sampleT } = TRAJECTORIES.get(id)!;
      let shortest = Infinity;
      let longest = 0;
      for (let i = 1; i < sampleT.length; i++) {
        const gap = sampleT[i] - sampleT[i - 1];
        shortest = Math.min(shortest, gap);
        longest = Math.max(longest, gap);
      }
      // A uniform grid of any step fails one of these two: minutes through
      // the encounters, months through the interstellar coast.
      expect(shortest).toBeLessThan(10 * 60);
      expect(longest).toBeGreaterThan(90 * 86400);
    });
  }
});

describe('resolved swing-bys', () => {
  for (const { probe, planet, utc } of ENCOUNTERS.filter((e) => e.assist)) {
    it(`${probe}'s ${planet} assist is drawn as a curve, not a corner`, () => {
      const traj = TRAJECTORIES.get(probe)!;
      const near = samplesNear(traj, utc, ASSIST_WINDOW_DAYS);
      expect(near.length).toBeGreaterThanOrEqual(MIN_ASSIST_SAMPLES);
      const sharpest = Math.max(...near.map((i) => segmentTurnDeg(traj, i)));
      expect(sharpest).toBeLessThan(MAX_SEGMENT_TURN_DEG);
    });
  }

  it('leaves the Pluto flyby coarse, because it bends nothing', () => {
    // The counterexample that shows the grid tracks curvature rather than
    // a hand-written list of interesting dates: New Horizons got no assist
    // from Pluto, so refinement found nothing to resolve and left month-
    // scale spacing across the encounter.
    const traj = TRAJECTORIES.get('newhorizons')!;
    const near = samplesNear(traj, '2015-07-14T00:00:00Z', 30);
    const bend = near.reduce((sum, i) => sum + segmentTurnDeg(traj, i), 0);
    expect(bend).toBeLessThan(0.1);
    expect(near.length).toBeLessThan(MIN_ASSIST_SAMPLES);
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
