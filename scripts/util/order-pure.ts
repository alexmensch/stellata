// The one ascending three-way comparator, and its string case. See README.md.

/** Ascending order by `<`: numeric for numbers and bigints, code-unit for strings. */
export function ascending<T extends string | number | bigint>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
export const compareCodeUnits: (a: string, b: string) => number = ascending;
