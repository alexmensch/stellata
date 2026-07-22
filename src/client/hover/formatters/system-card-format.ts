// Shared system-roster hover card for a screen-collapsed multi-object
// system (multi-star cluster, planet system). Both the star and planet
// formatters build their swap card here. See ../README.md.

import type { Target } from '../../camera/focus/focus-target';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../../system-membership/system-membership';
import type { HoverPayload } from '../hover-types';

/** Roster names shown before the list truncates to "+ N more" — sized
 *  so Sol's full sub-system (Sol + nine planets) fits uncut. */
export const SYSTEM_ROSTER_MAX_NAMES = 10;

/** A system needs at least this many members before the roster card
 *  replaces the per-object card: a 2-member system (a plain binary, a
 *  planet with one moon) is already covered by that card's companion /
 *  moon line, so the swap would only repeat it. */
export const MIN_SYSTEM_MEMBERS = 3;

/** Generic label for a member the providing implementation could not
 *  name — members are keyed on stable ids, never guaranteed a name. */
export const UNNAMED_MEMBER_LABEL = '(unnamed)';

/** Roster-card swap for a screen-collapsed system, shared by the star and
 *  planet formatters. Fires only when `target`'s collapsed cluster (members
 *  actually rendering as one point with it) is a real cluster AND the whole
 *  system has 3+ members. The roster lists the CLUSTER, not the full system:
 *  members the user can see separately on screen (Proxima beside the α Cen
 *  point, a resolved moon) must not be enumerated. `label` resolves a
 *  member's display name per kind. */
export function rosterCardOrNull(
  membership: SystemMembershipProvider,
  target: Target,
  ctxLine: string,
  label: (m: SystemMember) => string,
): HoverPayload | null {
  const cluster = membership.collapsedClusterOf(target);
  if (cluster.length < 2) return null;
  const members = membership.membersOf(target);
  if (members.length < MIN_SYSTEM_MEMBERS) return null;
  return systemCard(label(cluster[0]), ctxLine, members.length, cluster.map(label));
}

export function systemCard(
  leadName: string,
  ctxLine: string,
  memberCount: number,
  clusterNames: string[],
): HoverPayload {
  const lines: string[] = [];
  if (ctxLine) lines.push(ctxLine);
  lines.push(
    clusterNames.length === memberCount
      ? `${memberCount} components:`
      : `${clusterNames.length} of ${memberCount} components here:`,
    rosterLine(clusterNames),
  );
  return { name: `${leadName} system`, lines };
}

function rosterLine(names: string[]): string {
  if (names.length <= SYSTEM_ROSTER_MAX_NAMES) return names.join(', ');
  const shown = names.slice(0, SYSTEM_ROSTER_MAX_NAMES).join(', ');
  return `${shown} + ${names.length - SYSTEM_ROSTER_MAX_NAMES} more`;
}
