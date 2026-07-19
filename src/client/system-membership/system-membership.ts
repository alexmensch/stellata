// Kind-generic multi-object system membership: which objects form a
// system, and which of them currently render as one on-screen point.
// See ./README.md.

import type { Target } from '../camera/focus/focus-target';

export interface SystemMember {
  readonly target: Target;
  /** Display name, or null when the implementation cannot name the
   *  member — consumers resolve a per-kind fallback (stars via
   *  resolveStarName; anything else a generic label). */
  readonly name: string | null;
}

export interface SystemMembershipProvider {
  /** Every member of `target`'s system (target included), primary
   *  first. [] when this provider doesn't cover the target. */
  membersOf(target: Target): SystemMember[];
  /** Members currently rendering as one on-screen point with `target`
   *  (target included), primary first. [] when nothing is collapsed
   *  with it — or when this provider doesn't cover it. */
  collapsedClusterOf(target: Target): SystemMember[];
}

/** Union over every registered provider. Registration order is
 *  significant: the first provider that covers a target supplies the
 *  cluster's lead (binaries before planet systems, so a collapsed
 *  pair's outer primary outranks the member's own planet-host role). */
export class SystemMembershipRegistry implements SystemMembershipProvider {
  private readonly providers: SystemMembershipProvider[] = [];

  register(provider: SystemMembershipProvider): void {
    this.providers.push(provider);
  }

  membersOf(target: Target): SystemMember[] {
    return this.union((p) => p.membersOf(target));
  }

  collapsedClusterOf(target: Target): SystemMember[] {
    return this.union((p) => p.collapsedClusterOf(target));
  }

  /** The object a pick on `target`'s collapsed point should resolve
   *  to: the cluster's primary, or `target` itself when nothing is
   *  collapsed with it. */
  collapsedLeadOf(target: Target): Target {
    return this.collapsedClusterOf(target)[0]?.target ?? target;
  }

  private union(
    query: (p: SystemMembershipProvider) => SystemMember[],
  ): SystemMember[] {
    const out: SystemMember[] = [];
    const seen = new Set<string>();
    for (const provider of this.providers) {
      for (const member of query(provider)) {
        const key = `${member.target.kind}:${member.target.idx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(member);
      }
    }
    return out;
  }
}
