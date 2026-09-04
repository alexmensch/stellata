// Which pinned constants a TSL source restates as a bare literal. See
// ../solar-system/README.md § Constant drift runs in both directions.

export interface PinnedConstant {
  identifier: string;
  values: readonly number[];
}

/** A number a source spells out that is genuinely NOT the pinned constant
 *  sharing its value — a coincidence the scan cannot resolve on its own.
 *  `reason` is required so an exemption has to argue for itself. */
export interface DriftExemption {
  value: number;
  reason: string;
}

// Word-bounded on both ends so `vec3` and `LOG10` are identifiers, not
// numbers, and `1.0` is one literal rather than a `1` beside a `0`.
const NUMERIC_LITERAL = /(?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/g;

/**
 * Every pinned value the source spells out as a number, labelled by the
 * identifier it should have used instead.
 *
 * Comparison is by VALUE, never by text: shader code writes an integral
 * constant as `30.0`, which no text pattern for `30` matches — that form
 * is precisely the one a transcription drifts into.
 */
export function literalDriftOffenders(
  src: string,
  pinned: readonly PinnedConstant[],
  exempt: readonly DriftExemption[] = [],
): string[] {
  const spelled = new Set<number>();
  for (const [literal] of src.matchAll(NUMERIC_LITERAL)) spelled.add(Number(literal));
  const excused = new Set(exempt.map((e) => e.value));
  const offenders: string[] = [];
  for (const { identifier, values } of pinned) {
    for (const value of values) {
      if (spelled.has(value) && !excused.has(value)) offenders.push(`${identifier} (${value})`);
    }
  }
  return offenders;
}
