// How the binaries stages' build-log lines print a count, a tally of counts, and a gate's dropped pairs.

export function count(v: number): string {
  return v.toLocaleString('en-US');
}

/** `key=count, …`, in the tally's key order. */
export function countsListed(tally: Readonly<Record<string, number>>): string {
  return Object.entries(tally).map(([k, v]) => `${k}=${count(v)}`).join(', ');
}

export const DROPPED_PAIR_AUDIT_SAMPLE = 25;

/** A gate's dropped pairs never reach multiples.tsv, so this line is their only record. Empty when none dropped. */
export function droppedPairSample(reason: string, dropped: readonly string[]): string[] {
  if (dropped.length === 0) return [];
  const sample = dropped.slice(0, DROPPED_PAIR_AUDIT_SAMPLE).join(', ');
  const suffix = dropped.length > DROPPED_PAIR_AUDIT_SAMPLE ? ', …' : '';
  return [`${reason}: ${count(dropped.length)} pairs (sample: ${sample}${suffix})`];
}
