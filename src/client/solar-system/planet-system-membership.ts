// SystemMembershipProvider over attached planet systems, one hierarchy
// level at a time: a host's sub-system is its planets, a planet's its
// moons. See ../system-membership/README.md.

import type { Target } from '../camera/focus/focus-target';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../system-membership/system-membership';
import type { PlanetSystem } from './planet-system';

/** The PlanetBodyField surface this provider reads — structural so
 *  tests fake it without a WebGL field. `isCollapsedOntoParent` closes
 *  over the live camera in the integration shell. */
export interface PlanetMembershipSource {
  getAttachedPlanetSystem(hostStarIdx: number): PlanetSystem | null;
  hostPlanetOf(instanceIdx: number): { hostStarIdx: number; planetIdx: number } | null;
  instanceIndexOf(hostStarIdx: number, planetIdx: number): number | null;
  isCollapsedOntoParent(instanceIdx: number): boolean;
}

interface SubSystem {
  host: number;
  ps: PlanetSystem;
  owner: SystemMember;
  childIdxs: number[];
}

export function createPlanetSystemMembership(
  source: PlanetMembershipSource,
): SystemMembershipProvider {
  // A target's sub-system is the hierarchy level it OWNS: the host's
  // direct children are the planets (no parentName), a planet's its
  // moons (parentName === planet.name). Moons and childless planets
  // own no sub-system — a body that has collapsed into a parent's
  // point is unpickable anyway, so only owners ever surface a roster.
  // Deeper levels fold into their parent: a moon collapsed onto
  // Jupiter is represented BY Jupiter in Sol's roster, never listed
  // beside it — which is also exactly how exoplanet hosts will read
  // (host → planets, nothing deeper).
  const subSystemOf = (target: Target): SubSystem | null => {
    let host: number;
    let ownerName: string | undefined;
    let owner: SystemMember;
    if (target.kind === 'star') {
      host = target.idx;
      ownerName = undefined;
      owner = { target, name: null };
    } else if (target.kind === 'planet') {
      const hp = source.hostPlanetOf(target.idx);
      if (!hp) return null;
      host = hp.hostStarIdx;
      const named = source.getAttachedPlanetSystem(host)?.planets[hp.planetIdx]?.name;
      if (!named) return null;
      ownerName = named;
      owner = { target, name: named };
    } else {
      return null;
    }
    const ps = source.getAttachedPlanetSystem(host);
    if (!ps) return null;
    const childIdxs: number[] = [];
    for (let i = 0; i < ps.planets.length; i++) {
      if (ps.planets[i].parentName === ownerName) childIdxs.push(i);
    }
    if (childIdxs.length === 0) return null;
    return { host, ps, owner, childIdxs };
  };

  const bodyMember = (
    ps: PlanetSystem,
    host: number,
    planetIdx: number,
  ): SystemMember | null => {
    const flat = source.instanceIndexOf(host, planetIdx);
    if (flat === null) return null;
    return { target: { kind: 'planet', idx: flat }, name: ps.planets[planetIdx].name ?? null };
  };

  return {
    membersOf(target: Target): SystemMember[] {
      const sub = subSystemOf(target);
      if (!sub) return [];
      const members: SystemMember[] = [sub.owner];
      for (const i of sub.childIdxs) {
        const m = bodyMember(sub.ps, sub.host, i);
        if (m) members.push(m);
      }
      return members;
    },

    collapsedClusterOf(target: Target): SystemMember[] {
      const sub = subSystemOf(target);
      if (!sub) return [];
      const cluster: SystemMember[] = [sub.owner];
      for (const i of sub.childIdxs) {
        const m = bodyMember(sub.ps, sub.host, i);
        if (m && source.isCollapsedOntoParent(m.target.idx)) cluster.push(m);
      }
      return cluster.length < 2 ? [] : cluster;
    },
  };
}
