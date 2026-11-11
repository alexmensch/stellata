// Grouping into map buckets: a list or a set per key, created on first use.

export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.add(value);
  else map.set(key, new Set([value]));
}

/** Buckets in first-seen key order, items in input order. */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) pushTo(out, keyOf(item), item);
  return out;
}
