import { describe, expect, it } from 'vitest';
import {
  createPlanetSystemMembership,
  type PlanetMembershipSource,
} from './planet-system-membership';
import type { Planet, PlanetSystem } from './planet-system';

// Minimal host: two planets + two moons of the second planet. Flat
// instance indices offset by 10 to prove the provider round-trips
// through the attach table rather than assuming flat == planetIdx.
const BODY = (name: string, parentName?: string): Planet =>
  ({ name, parentName } as unknown as Planet);

const PLANETS: readonly Planet[] = [
  BODY('Mercury'),
  BODY('Jupiter'),
  BODY('Io', 'Jupiter'),
  BODY('Europa', 'Jupiter'),
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

describe('createPlanetSystemMembership — one hierarchy level per target', () => {
  it("a host's sub-system is itself + its planets, never the moons", () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    expect(p.membersOf(starT(HOST))).toEqual([
      { target: { kind: 'star', idx: HOST }, name: null },
      { target: { kind: 'planet', idx: 10 }, name: 'Mercury' },
      { target: { kind: 'planet', idx: 11 }, name: 'Jupiter' },
    ]);
  });

  it("a planet's sub-system is itself + its moons", () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    expect(p.membersOf(planetT(11))).toEqual([
      { target: { kind: 'planet', idx: 11 }, name: 'Jupiter' },
      { target: { kind: 'planet', idx: 12 }, name: 'Io' },
      { target: { kind: 'planet', idx: 13 }, name: 'Europa' },
    ]);
  });

  it('childless bodies (moons, moon-less planets) own no sub-system', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set([12, 13])));
    expect(p.membersOf(planetT(10))).toEqual([]); // Mercury
    expect(p.membersOf(planetT(12))).toEqual([]); // Io
    expect(p.collapsedClusterOf(planetT(10))).toEqual([]);
    expect(p.collapsedClusterOf(planetT(12))).toEqual([]);
  });

  it('membersOf is [] for unattached hosts and non-planet kinds', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set()));
    expect(p.membersOf(starT(7))).toEqual([]);
    expect(p.membersOf(planetT(99))).toEqual([]);
    expect(p.membersOf({ kind: 'cloud', idx: 0 })).toEqual([]);
  });

  it("the host's cluster lists collapsed planets only — a collapsed moon folds into its planet", () => {
    // Mercury collapsed onto the host; Io collapsed onto Jupiter;
    // Jupiter itself resolved. Sol's roster shows Mercury alone: Io is
    // represented by Jupiter one level down, and Jupiter isn't here.
    const p = createPlanetSystemMembership(sourceWith(new Set([10, 12])));
    const cluster = p.collapsedClusterOf(starT(HOST));
    expect(cluster.map((m) => m.name)).toEqual([null, 'Mercury']);
    expect(cluster[0].target).toEqual({ kind: 'star', idx: HOST });
  });

  it('a planet with collapsed moons forms its own cluster, planet first', () => {
    const p = createPlanetSystemMembership(sourceWith(new Set([12])));
    const cluster = p.collapsedClusterOf(planetT(11));
    expect(cluster.map((m) => m.name)).toEqual(['Jupiter', 'Io']);
  });

  it('cluster is [] when no direct child is collapsed', () => {
    // Io collapsed onto Jupiter has no bearing on the HOST's cluster.
    const p = createPlanetSystemMembership(sourceWith(new Set([12])));
    expect(p.collapsedClusterOf(starT(HOST))).toEqual([]);
    // And a fully resolved system reports none anywhere.
    const q = createPlanetSystemMembership(sourceWith(new Set()));
    expect(q.collapsedClusterOf(starT(HOST))).toEqual([]);
    expect(q.collapsedClusterOf(planetT(11))).toEqual([]);
  });
});
