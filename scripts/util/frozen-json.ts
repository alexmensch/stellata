// Emit shape shared by the frozen row-per-sample JSON artifacts under data/
// (probe trajectories, planet element tables).

export function roundSignificant(v: number, digits: number): number {
  return Number(v.toPrecision(digits));
}

/**
 * One array per sample on its own line: no repeated keys (these files are
 * thousands of rows) while a refresh still diffs sample-by-sample in git.
 */
export function serializeRowFile<T extends { samples: number[][] }>(file: T): string {
  const { samples, ...head } = file;
  const token = '__SAMPLES__';
  const scaffold = JSON.stringify({ ...head, samples: token }, null, 2);
  const rows = samples.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return `${scaffold.replace(`"${token}"`, `[\n${rows}\n  ]`)}\n`;
}
