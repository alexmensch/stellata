// Pure planning for the card rolodex: which card is in front, which
// cards render as header strips, and the strip height for the count.
// See ./README.md § Rolodex behaviour.

import { targetsEqual, type Target, type TargetKind } from '../camera/focus/focus-target';

/** `'focus'` or `poi:<kind>:<index>`. */
export type CardKey = string;

export const FOCUS_KEY: CardKey = 'focus';

export function poiKey(target: Target): CardKey {
  return `poi:${target.kind}:${target.idx}`;
}

export function poiTargetOf(key: CardKey): Target | null {
  if (!key.startsWith('poi:')) return null;
  const sep = key.indexOf(':', 4);
  if (sep < 0) return null;
  return {
    kind: key.slice(4, sep) as TargetKind,
    idx: Number(key.slice(sep + 1)),
  };
}

export interface RolodexInputs {
  /** Pinned targets in store order (oldest pin first). */
  pois: readonly Target[];
  /** Focused object — its pin card is suppressed while focused. */
  focused: Target | null;
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
  /** Card to name/count when minimized: the focused object if one is
   *  visible, else `front` (matches `front` whenever there's no focus
   *  to prefer). Null only alongside `front === null`. */
  minimizedFront: CardKey | null;
}

export function planRolodex(o: RolodexInputs): RolodexPlan {
  const cards: CardKey[] = [];
  if (o.focusVisible) cards.push(FOCUS_KEY);
  for (let i = o.pois.length - 1; i >= 0; i--) {
    if (!targetsEqual(o.pois[i], o.focused)) cards.push(poiKey(o.pois[i]));
  }
  const front =
    o.desiredFront !== null && cards.includes(o.desiredFront)
      ? o.desiredFront
      : (cards[0] ?? null);
  const minimizedFront = o.focusVisible ? FOCUS_KEY : front;
  return { front, strips: cards.filter((key) => key !== front), minimizedFront };
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
