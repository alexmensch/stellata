// Pure planning for the POI card stack: which cards to create or
// remove, and the display order (newest pin on top). See ./README.md.

export interface StackPlan {
  /** Pins with no card yet, in store order. */
  added: number[];
  /** Cards whose pin is gone. */
  removed: number[];
  /** Full display order, newest pin first. */
  order: number[];
}

/** Both lists are store lists in insertion order (oldest pin first). */
export function planStack(
  prev: readonly number[],
  next: readonly number[],
): StackPlan {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((idx) => !prevSet.has(idx)),
    removed: prev.filter((idx) => !nextSet.has(idx)),
    order: [...next].reverse(),
  };
}
