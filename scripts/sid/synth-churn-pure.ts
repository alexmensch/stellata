// The candidate report for synthetic keys that left the build with no decision: every live synth key under the same WDS root, with its row's geometry. See README.md#ownership-pin--synth-churn-resolves-here.

import { wdsRootOf } from '../binaries/component-tokens-pure';

export interface PairGeometry {
  readonly systemId: string;
  readonly comp: string;
  readonly sepArcsec: number | null;
  readonly paDeg: number | null;
}

function wdsOf(systemIdOrKey: string): string {
  const root = wdsRootOf(systemIdOrKey);
  if (root === null) throw new Error(`${systemIdOrKey} names no WDS id`);
  return root;
}

/** `orphans` and `live` are synth keys without their `synth:` namespace, `<wds>-<comp>`. */
export function synthChurnReport(
  orphans: readonly string[], live: readonly string[], rows: readonly PairGeometry[],
): string {
  const lines: string[] = [];
  for (const key of orphans) {
    const root = wdsOf(key);
    lines.push(`  synth:${key} — no live synth key matches (WDS root ${root})`);
    const siblings = live.filter((k) => wdsOf(k) === root);
    for (const sib of siblings) {
      const comp = sib.slice(root.length + 1);
      const row = rows.find((r) => wdsOf(r.systemId) === root && r.comp === comp);
      const geometry = row === undefined ? '' : ` (comp ${row.comp}, sep ${row.sepArcsec ?? '—'}", PA ${row.paDeg ?? '—'}°)`;
      lines.push(`    candidate synth:${sib}${geometry}`);
    }
    if (siblings.length === 0) lines.push('    (no live synth keys under this WDS root)');
  }
  lines.push(
    '  A re-lettered component takes a bridge line in data/sid/sameas-overrides.tsv',
    '  (/docs/sid.md#5-synthetic-key-churn-wds-re-subdivision); one that dissolved takes a',
    '  coded decision in the stage that drops it.',
  );
  return lines.join('\n');
}
