// SystemMembershipProvider over binaries.bin — the relation-graph walk
// in ../format/star-companion-format.ts wrapped in the kind-generic
// membership contract. See ../system-membership/README.md.

import type { Target } from '../camera/focus/focus-target';
import {
  collapsedClusterIndices,
  systemMemberIndices,
} from '../format/star-companion-format';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../system-membership/system-membership';
import type { BinariesData } from './binaries-loader';

export interface BinarySystemMembershipDeps {
  getBinaries: () => BinariesData | null;
  /** Live per-star composite-suppress verdict — the orbit walk's own
   *  sub-pixel LOD (Stellata.isCompositeSuppressed). */
  isCollapsed: (starIdx: number) => boolean;
}

// Star names resolve in the consumer (resolveStarName needs the name
// context this provider deliberately doesn't hold).
function starMember(idx: number): SystemMember {
  return { target: { kind: 'star', idx }, name: null };
}

export function createBinarySystemMembership(
  deps: BinarySystemMembershipDeps,
): SystemMembershipProvider {
  return {
    membersOf(target: Target): SystemMember[] {
      if (target.kind !== 'star') return [];
      const binaries = deps.getBinaries();
      if (!binaries) return [];
      return systemMemberIndices(binaries, target.idx).map(starMember);
    },
    collapsedClusterOf(target: Target): SystemMember[] {
      if (target.kind !== 'star') return [];
      const binaries = deps.getBinaries();
      if (!binaries) return [];
      const cluster = collapsedClusterIndices(binaries, target.idx, deps.isCollapsed);
      // A singleton is "nothing collapsed here" (covers both a star in
      // no relation and a visibly separated member like Proxima).
      return cluster.length < 2 ? [] : cluster.map(starMember);
    },
  };
}
