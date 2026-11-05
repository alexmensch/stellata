// Decimal rounding for numbers a build writes into an artifact. See README.md.

/** Python's `round(x, digits)`: half-to-even on the double's exact decimal value. */
export function roundHalfEven(x: number, digits: number): number {
  const exact = Math.abs(x).toFixed(100);
  const cut = exact.indexOf('.') + 1 + digits;
  const rest = exact.slice(cut);
  const tie = /^50*$/.test(rest);
  if (!tie) return Number(x.toFixed(digits));
  const kept = exact.slice(0, cut).replace(/\.$/, '');
  const lastDigit = Number(kept[kept.length - 1]);
  const truncated = Number(kept);
  const step = 10 ** -digits;
  const magnitude = lastDigit % 2 === 0 ? truncated : Number((truncated + step).toFixed(digits));
  return Math.sign(x) * magnitude;
}

/** Each element through roundHalfEven, keeping a tuple's length in its type. */
export function roundEach<T extends readonly number[]>(v: T, digits: number): { -readonly [I in keyof T]: number } {
  return v.map((x) => roundHalfEven(x, digits)) as { -readonly [I in keyof T]: number };
}

/** `v` to `digits` significant figures, rounded on the double's exact decimal value. */
export function roundSignificant(v: number, digits: number): number {
  return Number(v.toPrecision(digits));
}
