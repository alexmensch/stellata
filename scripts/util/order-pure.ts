// The one ascending three-way comparator, and its string case. See README.md.

/** Ascending order by `<`: numeric for numbers and bigints, code-unit for strings. */
export function ascending(a: string, b: string): number;
export function ascending(a: number | bigint, b: number | bigint): number;
export function ascending(a: string | number | bigint, b: string | number | bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
export const compareCodeUnits: (a: string, b: string) => number = ascending;
