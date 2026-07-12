// Pure planning for the card rolodex: which card is in front, which
// cards render as header strips, and the strip height for the count.
// See ./README.md § Rolodex behaviour.

/** `'focus'` or `poi:<catalog row index>`. */
export type CardKey = string;

export const FOCUS_KEY: CardKey = 'focus';

export function poiKey(idx: number): CardKey {
  return `poi:${idx}`;
}

export function poiIdxOf(key: CardKey): number | null {
  return key.startsWith('poi:') ? Number(key.slice(4)) : null;
}

export interface RolodexInputs {
  /** Pinned star indices in store order (oldest pin first). */
  pois: readonly number[];
  /** Focused star — its pin card is suppressed while focused. */
  focusedStar: number | null;
  /** Whether the focus card is a stack member right now. */
  focusVisible: boolean;
  /** Last promote / auto-front request; null = default front. */
  desiredFront: CardKey | null;
}

export interface RolodexPlan {
  /** The one fully visible card; null = whole stack hidden. */
  front: CardKey | null;
  /** Header strips top to bottom: focus card, then pins newest-first. */
  strips: CardKey[];
}

export function planRolodex(o: RolodexInputs): RolodexPlan {
  const cards: CardKey[] = [];
  if (o.focusVisible) cards.push(FOCUS_KEY);
  for (let i = o.pois.length - 1; i >= 0; i--) {
    if (o.pois[i] !== o.focusedStar) cards.push(poiKey(o.pois[i]));
  }
  const front =
    o.desiredFront !== null && cards.includes(o.desiredFront)
      ? o.desiredFront
      : (cards[0] ?? null);
  return { front, strips: cards.filter((key) => key !== front) };
}

export const STRIP_HEIGHT_MAX_PX = 26;
export const STRIP_HEIGHT_MIN_PX = 15;
/** Height budget for the whole strip band — at the 16-pin cap every
 *  strip still fits above the front card without scrolling. */
export const STRIP_BAND_MAX_PX = 240;

export function stripHeightPx(stripCount: number): number {
  if (stripCount === 0) return STRIP_HEIGHT_MAX_PX;
  const fit = Math.floor(STRIP_BAND_MAX_PX / stripCount);
  return Math.min(STRIP_HEIGHT_MAX_PX, Math.max(STRIP_HEIGHT_MIN_PX, fit));
}
