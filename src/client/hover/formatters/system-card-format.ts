// Shared system-roster hover card for a screen-collapsed multi-object
// system (multi-star cluster, planet system). Both the star and planet
// formatters build their swap card here. See ../README.md.

import type { HoverPayload } from '../hover-types';

/** Roster names shown before the list truncates to "+ N more" — keeps
 *  the card glanceable for a 28-body planet system. */
export const SYSTEM_ROSTER_MAX_NAMES = 8;

/** Generic label for a member the providing implementation could not
 *  name — members are keyed on stable ids, never guaranteed a name. */
export const UNNAMED_MEMBER_LABEL = '(unnamed)';

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
