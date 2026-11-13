// Decimal rounding for numbers a build writes into an artifact. See README.md.

/** |x| as `digits × 10^scale`, exactly. */
function exactDecimal(x: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const power = biased === 0 ? -1074 : biased - 1075;
  if (mantissa === 0n) return { digits: 0n, scale: 0 };
  return power >= 0
    ? { digits: mantissa << BigInt(power), scale: 0 }
    : { digits: mantissa * 5n ** BigInt(-power), scale: power };
}

/** `n` with its last `drop` decimal digits rounded off half to even; a negative `drop` appends zeros. */
function roundDecimal(n: bigint, drop: number): bigint {
  if (drop <= 0) return n * 10n ** BigInt(-drop);
  const unit = 10n ** BigInt(drop);
  const kept = n / unit;
  const twice = 2n * (n % unit);
  return twice > unit || (twice === unit && kept % 2n === 1n) ? kept + 1n : kept;
}

const signOf = (x: number): string => (x < 0 || Object.is(x, -0) ? '-' : '');

/** Python's `f"{x:.{digits}f}"`: half-to-even on the exact value, and a negative that rounds to zero keeps its sign. */
export function formatFixed(x: number, digits: number): string {
  const exact = exactDecimal(x);
  const scaled = roundDecimal(exact.digits, -(exact.scale + digits)).toString().padStart(digits + 1, '0');
  const text = digits === 0 ? scaled : `${scaled.slice(0, -digits)}.${scaled.slice(-digits)}`;
  return `${signOf(x)}${text}`;
}

/** Python's `round(x, digits)`: half-to-even on the double's exact decimal value. */
export function roundHalfEven(x: number, digits: number): number {
  return Number(formatFixed(x, digits));
}

/** Python's `f"{x:.{digits}e}"`: half-to-even on the exact value, the exponent at least two digits. */
export function formatExponent(x: number, digits: number): string {
  let kept = 0n;
  let exponent = 0;
  if (x !== 0) {
    const exact = exactDecimal(x);
    const length = exact.digits.toString().length;
    exponent = length - 1 + exact.scale;
    kept = roundDecimal(exact.digits, length - (digits + 1));
    if (kept === 10n ** BigInt(digits + 1)) {
      kept /= 10n;
      exponent += 1;
    }
  }
  const mantissa = kept.toString().padStart(digits + 1, '0');
  const point = digits === 0 ? mantissa : `${mantissa[0]}.${mantissa.slice(1)}`;
  return `${signOf(x)}${point}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
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
