// Moon-roster text for a moon-parenting planet's hover card, from the
// parent's moon names in semi-major-axis order. See README.md.

/**
 * Capped comma roster: null for a moonless body; past `maxNames` the
 * list truncates to `maxNames − 1` names plus a "+N more" tail, so the
 * line never grows past `maxNames` name-sized units (the hover card's
 * glanceability budget).
 */
export function moonRosterText(
  names: readonly string[],
  maxNames = Infinity,
): string | null {
  if (names.length === 0) return null;
  const shown = names.length > maxNames ? names.slice(0, maxNames - 1) : names;
  const tail = names.length > maxNames ? ` +${names.length - shown.length} more` : '';
  return `${shown.join(', ')}${tail}`;
}
