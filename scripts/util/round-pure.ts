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

/** Python's `f"{x:.{digits}f}"`: half-to-even on the exact value, and a negative that rounds to zero keeps its sign. */
export function formatFixed(x: number, digits: number): string {
  const text = roundHalfEven(x, digits).toFixed(digits);
  return (x < 0 || Object.is(x, -0)) && !text.startsWith('-') ? `-${text}` : text;
}

export type FloatWidth = 'double' | 'float32';

const POSITIONAL_BELOW: Record<FloatWidth, number> = { double: 1e16, float32: 1e6 };

/** The fewest significant digits, as `toExponential` text, that read back to `x` at `width`. */
function shortest(x: number, width: FloatWidth): string {
  if (width === 'double') return x.toExponential();
  for (let digits = 1; ; digits++) {
    const text = x.toExponential(digits - 1);
    if (Math.fround(Number(text)) === x) return text;
  }
}

/** Python's `repr(x)` of a double, or numpy's `str` of a float32 (`x` already `Math.fround`ed): shortest round-trip digits, positional from 1e-4 up to 1e16 (float32: 1e6), else `d.ddde±XX`. */
export function formatRepr(x: number, width: FloatWidth = 'double'): string {
  if (!Number.isFinite(x)) throw new Error(`formatRepr: ${x} is not finite`);
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mantissa, exponent] = shortest(x, width).split('e');
  const sign = x < 0 ? '-' : '';
  const digits = mantissa.replace(/^-/, '').replace('.', '');
  const e = Number(exponent);
  if (Math.abs(x) < 1e-4 || Math.abs(x) >= POSITIONAL_BELOW[width]) {
    const lead = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
    return `${sign}${lead}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  return `${sign}${digits.slice(0, e + 1).padEnd(e + 1, '0')}.${digits.slice(e + 1) || '0'}`;
}

/** Each element through roundHalfEven, keeping a tuple's length in its type. */
export function roundEach<T extends readonly number[]>(v: T, digits: number): { -readonly [I in keyof T]: number } {
  return v.map((x) => roundHalfEven(x, digits)) as { -readonly [I in keyof T]: number };
}

/** `v` to `digits` significant figures, rounded on the double's exact decimal value. */
export function roundSignificant(v: number, digits: number): number {
  return Number(v.toPrecision(digits));
}
