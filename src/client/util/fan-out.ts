// Run every member of a fan-out even when one throws. See README.md.

/**
 * Call `fn` for each item, then rethrow anything that failed.
 *
 * A bare `for (const x of xs) x.hook()` stops at the first throw, so the
 * items after it silently never get the call. For a fan-out that puts a
 * shared piece of state into a new mode — a palette swap, a recentre, a
 * teardown — that leaves the scene half in each mode with no recovery
 * path: the caller's own later steps are skipped too, and re-entering the
 * mode does nothing because the state that drives it already flipped.
 *
 * Failures are collected, not swallowed. Every item is attempted, and one
 * `AggregateError` carrying all of them is thrown at the end, so a broken
 * layer is exactly as loud as it was before — it just can no longer take
 * its siblings down with it.
 *
 * `label` names the fan-out in that error; pass the method name.
 */
export function fanOut<T>(label: string, items: Iterable<T>, fn: (item: T) => void): void {
  let failures: unknown[] | null = null;
  for (const item of items) {
    try {
      fn(item);
    } catch (err) {
      (failures ??= []).push(err);
    }
  }
  if (failures !== null) {
    throw new AggregateError(
      failures,
      `${label}: ${failures.length} of the fan-out threw; the rest still ran`,
    );
  }
}
