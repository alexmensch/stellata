// How the binaries stages' build-log lines print a count, and a tally of them.

export function count(v: number): string {
  return v.toLocaleString('en-US');
}

/** `key=count, …`, in the tally's key order. */
export function countsListed(tally: Readonly<Record<string, number>>): string {
  return Object.entries(tally).map(([k, v]) => `${k}=${count(v)}`).join(', ');
}
