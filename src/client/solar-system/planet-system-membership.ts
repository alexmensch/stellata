// SystemMembershipProvider over attached planet systems: host star +
// bodies, clusters from the per-body collapsed-onto-parent verdict.
// See ../system-membership/README.md.

import type { Target } from '../camera/focus/focus-target';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../system-membership/system-membership';
import { parentIndexOf } from './orbit-descriptor';
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

// Node id −1 is the host star; 0..n−1 are planets-array indices.
const HOST_NODE = -1;

export function createPlanetSystemMembership(
  source: PlanetMembershipSource,
): SystemMembershipProvider {
  const hostOf = (target: Target): number | null => {
    if (target.kind === 'star') {
      return source.getAttachedPlanetSystem(target.idx) ? target.idx : null;
    }
    if (target.kind === 'planet') {
      return source.hostPlanetOf(target.idx)?.hostStarIdx ?? null;
    }
    return null;
  };

  const hostMember = (hostStarIdx: number): SystemMember => ({
    target: { kind: 'star', idx: hostStarIdx },
    name: null,
  });

  const bodyMember = (
    ps: PlanetSystem,
    hostStarIdx: number,
    planetIdx: number,
  ): SystemMember | null => {
    const flat = source.instanceIndexOf(hostStarIdx, planetIdx);
    if (flat === null) return null;
    return { target: { kind: 'planet', idx: flat }, name: ps.planets[planetIdx].name ?? null };
  };

  return {
    membersOf(target: Target): SystemMember[] {
      const host = hostOf(target);
      if (host === null) return [];
      const ps = source.getAttachedPlanetSystem(host);
      if (!ps) return [];
      const members: SystemMember[] = [hostMember(host)];
      for (let i = 0; i < ps.planets.length; i++) {
        const m = bodyMember(ps, host, i);
        if (m) members.push(m);
      }
      return members;
    },

    collapsedClusterOf(target: Target): SystemMember[] {
      const host = hostOf(target);
      if (host === null) return [];
      const ps = source.getAttachedPlanetSystem(host);
      if (!ps) return [];
      const n = ps.planets.length;

      // Tree edges child → parent (host or parent body), active iff
      // the child currently collapses onto its parent — the same
      // undirected active-edge walk the binary cluster runs.
      const parent = new Array<number>(n);
      const edgeActive = new Array<boolean>(n);
      for (let i = 0; i < n; i++) {
        const parentName = ps.planets[i].parentName;
        parent[i] = parentName ? parentIndexOf(ps.planets, parentName) : HOST_NODE;
        const flat = source.instanceIndexOf(host, i);
        edgeActive[i] = flat !== null && source.isCollapsedOntoParent(flat);
      }

      const start =
        target.kind === 'star'
          ? HOST_NODE
          : source.hostPlanetOf(target.idx)?.planetIdx ?? HOST_NODE;
      const component = new Set<number>();
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop() as number;
        if (component.has(node)) continue;
        component.add(node);
        if (node !== HOST_NODE && edgeActive[node]) stack.push(parent[node]);
        for (let i = 0; i < n; i++) {
          if (parent[i] === node && edgeActive[i]) stack.push(i);
        }
      }
      if (component.size < 2) return [];

      // Canonical primary-first order: host, then bodies ascending
      // (planets precede moons in every PlanetSystem roster).
      const out: SystemMember[] = [];
      if (component.has(HOST_NODE)) out.push(hostMember(host));
      for (let i = 0; i < n; i++) {
        if (!component.has(i)) continue;
        const m = bodyMember(ps, host, i);
        if (m) out.push(m);
      }
      return out;
    },
  };
}
