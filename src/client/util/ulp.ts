// Distance between two float64s counted in representable steps, for the
// places that compare by exact equality and need to say how far apart a
// mismatch actually is.

const ULP_VIEW = /*@__PURE__*/ new DataView(new ArrayBuffer(8));
const F64_SIGN = 0x8000000000000000n;

/** The float64's bit pattern remapped to a monotonically increasing key, so
 *  a subtraction between two keys counts representable steps. Negatives fold
 *  below zero and both zeros key to 0. */
function orderedKey(v: number): bigint {
  ULP_VIEW.setFloat64(0, v);
  const bits = ULP_VIEW.getBigUint64(0);
  return (bits & F64_SIGN) !== 0n ? F64_SIGN - bits : bits;
}

/** Representable float64 steps between two values.
 *
 *  This is the number that separates the two ways a derived value "moves",
 *  which look identical in any readout printing only a raw delta. A drift of
 *  a handful of ULP is a computation that will not converge — a value
 *  re-derived each frame from inputs that round differently — and no amount
 *  of waiting settles it. Millions of ULP is something genuinely moving, and
 *  the right question is then what. NaN for a non-finite operand.
 *
 *  ULP is scale-free, which is what makes a threshold in it admissible where
 *  a world-space epsilon would not be (AGENTS.md § Camera-anywhere): one step
 *  is the same proportional distance at Sol and at the LMC. */
export function ulpsBetween(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  const d = orderedKey(a) - orderedKey(b);
  return Number(d < 0n ? -d : d);
}
