// "Moons: …" roster line for a moon-parenting planet, shared by the
// planet hover card and the focus card so the two tiers can't diverge.

/**
 * Roster line from a parent's moon names (semi-major-axis order).
 * Returns null for a moonless body — the caller omits the line. When
 * `maxNames` is exceeded the list truncates to `maxNames − 1` names
 * plus a "+N more" tail, so the line never grows past `maxNames`
 * name-sized units (the hover card's glanceability budget).
 */
export function formatMoonsLine(
  names: readonly string[],
  maxNames = Infinity,
): string | null {
  if (names.length === 0) return null;
  const shown = names.length > maxNames ? names.slice(0, maxNames - 1) : names;
  const tail = names.length > maxNames ? ` +${names.length - shown.length} more` : '';
  return `Moons: ${shown.join(', ')}${tail}`;
}
