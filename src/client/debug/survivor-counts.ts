// debug.survivors(). README.md § Survivor counts.

import type { Stellata } from '../stellata';
import type { SurvivorCounts } from '../webgpu/star/compaction/compaction-pure';

export interface SurvivorReport extends SurvivorCounts {
  /** Catalogue records the kernel dispatched over. */
  records: number;
  glowFraction: number;
  discFraction: number;
  /** Both tiers over records — the ratio an elision decision on the star
   *  path is sized against. */
  drawnFraction: number;
}

export function survivorReport(counts: SurvivorCounts, records: number): SurvivorReport {
  const per = (n: number) => (records > 0 ? n / records : 0);
  return {
    ...counts,
    records,
    glowFraction: per(counts.glow),
    discFraction: per(counts.disc),
    drawnFraction: per(counts.glow + counts.disc),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export function formatSurvivorReport(r: SurvivorReport): string {
  return [
    `survivors: ${r.glow + r.disc} of ${r.records} records (${pct(r.drawnFraction)})`,
    `  glow tier ${r.glow} (${pct(r.glowFraction)})`,
    `  disc tier ${r.disc} (${pct(r.discFraction)})`,
  ].join('\n');
}

/** Null on a WebGL2 boot, which lists no survivors — its three draws are
 *  priced at the whole catalogue. */
export async function readSurvivorReport(stellata: Stellata): Promise<SurvivorReport | null> {
  const counts = await stellata.readSurvivorCounts();
  if (counts === null) return null;
  return survivorReport(counts, stellata.catalog.count);
}
