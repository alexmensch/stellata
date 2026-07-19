import { describe, expect, it } from 'vitest';
import {
  createPlanetSystemMembership,
  type PlanetMembershipSource,
} from './planet-system-membership';
import type { Planet, PlanetSystem } from './planet-system';

// Minimal host: two planets + one moon of the second planet. Flat
// instance indices offset by 10 to prove the provider round-trips
// through the attach table rather than assuming flat == planetIdx.
const BODY = (name: string, parentName?: string): Planet =>
  ({ name, parentName } as unknown as Planet);

const PLANETS: readonly Planet[] = [
  BODY('Mercury'),
  BODY('Jupiter'),
  BODY('Io', 'Jupiter'),
];
const HOST = 42;
const FLAT_BASE = 10;

function sourceWith(collapsedFlats: Set<number>): PlanetMembershipSource {
  const ps = { hostStarIdx: HOST, planets: PLANETS } as PlanetSystem;
  return {
    getAttachedPlanetSystem: (h) => (h === HOST ? ps : null),
    hostPlanetOf: (flat) => {
      const i = flat - FLAT_BASE;
      return i >= 0 && i < PLANETS.length ? { hostStarIdx: HOST, planetIdx: i } : null;
    },
    instanceIndexOf: (h, i) =>
      h === HOST && i >= 0 && i < PLANETS.length ? FLAT_BASE + i : null,
    isCollapsedOntoParent: (flat) => collapsedFlats.has(flat),
  };
}

const starT = (idx: number) => ({ kind: 'star', idx }) as const;
const planetT = (idx: number) => ({ kind: 'planet', idx }) as const;

describe('createPlanetSystemMembership', () => {
  it('membersOf lists the host first, then every body with its name', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    const members = p.membersOf(starT(HOST));
    expect(members).toEqual([
      { target: { kind: 'star', idx: HOST }, name: null },
      { target: { kind: 'planet', idx: 10 }, name: 'Mercury' },
      { target: { kind: 'planet', idx: 11 }, name: 'Jupiter' },
      { target: { kind: 'planet', idx: 12 }, name: 'Io' },
    ]);
    // A body target resolves the same system.
    expect(p.membersOf(planetT(12))).toEqual(members);
  });

  it('membersOf is [] for unattached hosts and non-planet kinds', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    expect(p.membersOf(starT(7))).toEqual([]);
    expect(p.membersOf(planetT(99))).toEqual([]);
    expect(p.membersOf({ kind: 'cloud', idx: 0 })).toEqual([]);
  });

  it('cluster from the host spans bodies reachable through collapsed edges only', () => {
    // Mercury collapsed onto the host; Jupiter resolved; Io collapsed
    // onto Jupiter (reachable from Jupiter, NOT from the host).
    const p = createPlanetSystemMembership(sourceWith(new Set([10, 12])));
    const cluster = p.collapsedClusterOf(starT(HOST));
    expect(cluster.map((m) => m.name)).toEqual([null, 'Mercury']);
    expect(cluster[0].target).toEqual({ kind: 'star', idx: HOST });
  });

  it('a planet with collapsed moons forms its own sub-cluster, planet first', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set([12])));
    const cluster = p.collapsedClusterOf(planetT(11));
    expect(cluster.map((m) => m.name)).toEqual(['Jupiter', 'Io']);
    // The host is not in the component — Jupiter is resolved from it.
    expect(cluster.every((m) => m.target.kind === 'planet')).toBe(true);
    // The collapsed moon reports the same cluster.
    expect(p.collapsedClusterOf(planetT(12))).toEqual(cluster);
  });

  it('a fully collapsed chain reaches the host from every member', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set([10, 11, 12])));
    const fromMoon = p.collapsedClusterOf(planetT(12));
    expect(fromMoon.map((m) => m.name)).toEqual([null, 'Mercury', 'Jupiter', 'Io']);
    expect(fromMoon[0].target).toEqual({ kind: 'star', idx: HOST });
  });

  it('cluster is [] when nothing is collapsed', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    expect(p.collapsedClusterOf(starT(HOST))).toEqual([]);
    expect(p.collapsedClusterOf(planetT(11))).toEqual([]);
  });
});
