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

/** |x| as `digits × 10^scale`, exactly. */
function exactDecimal(x: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const power = biased === 0 ? -1074 : biased - 1075;
  return power >= 0
    ? { digits: mantissa << BigInt(power), scale: 0 }
    : { digits: mantissa * 5n ** BigInt(-power), scale: power };
}

/** Python's `f"{x:.{digits}e}"`: half-to-even on the exact value, the exponent at least two digits. */
export function formatExponent(x: number, digits: number): string {
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  let kept = 0n;
  let exponent = 0;
  if (x !== 0) {
    const exact = exactDecimal(x);
    const text = exact.digits.toString();
    exponent = text.length - 1 + exact.scale;
    kept = BigInt(text.slice(0, digits + 1).padEnd(digits + 1, '0'));
    const rest = text.slice(digits + 1);
    const lead = rest.charAt(0);
    const up = lead > '5' || (lead === '5' && (/[1-9]/.test(rest.slice(1)) || kept % 2n === 1n));
    if (up) kept += 1n;
    if (kept >= 10n ** BigInt(digits + 1)) {
      kept /= 10n;
      exponent += 1;
    }
  }
  const mantissa = kept.toString().padStart(digits + 1, '0');
  const point = digits === 0 ? mantissa : `${mantissa[0]}.${mantissa.slice(1)}`;
  return `${sign}${point}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

/** Each element through roundHalfEven, keeping a tuple's length in its type. */
export function roundEach<T extends readonly number[]>(v: T, digits: number): { -readonly [I in keyof T]: number } {
  return v.map((x) => roundHalfEven(x, digits)) as { -readonly [I in keyof T]: number };
}

/** `v` to `digits` significant figures, rounded on the double's exact decimal value. */
export function roundSignificant(v: number, digits: number): number {
  return Number(v.toPrecision(digits));
}
