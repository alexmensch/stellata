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
  /** Stars passing the dust-independent prefilter, over records. */
  prefilterFraction: number;
  /** Both tiers over the prefilter count — what the frustum alone removes
   *  from a kernel that already gates on the prefilter. */
  drawnOfPrefilter: number;
}

export function survivorReport(counts: SurvivorCounts, records: number): SurvivorReport {
  const per = (n: number) => (records > 0 ? n / records : 0);
  const drawn = counts.glow + counts.disc;
  return {
    ...counts,
    records,
    glowFraction: per(counts.glow),
    discFraction: per(counts.disc),
    drawnFraction: per(drawn),
    prefilterFraction: per(counts.prefilter),
    drawnOfPrefilter: counts.prefilter > 0 ? drawn / counts.prefilter : 0,
  };
}

/** A fraction as a percentage. `decimals` is the caller's, because the
 *  console line and the canon-vantage table want different resolutions. */
export const survivorPct = (x: number, decimals = 2): string =>
  `${(x * 100).toFixed(decimals)}%`;

export function formatSurvivorReport(r: SurvivorReport): string {
  return [
    `survivors: ${r.glow + r.disc} of ${r.records} records (${survivorPct(r.drawnFraction)})`,
    `  glow tier ${r.glow} (${survivorPct(r.glowFraction)})`,
    `  disc tier ${r.disc} (${survivorPct(r.discFraction)})`,
    `  passing the prefilter ${r.prefilter} (${survivorPct(r.prefilterFraction)}); `
      + `drawn of those ${survivorPct(r.drawnOfPrefilter)}`,
  ].join('\n');
}

/** Null on a WebGL2 boot, which lists no survivors — its three draws are
 *  priced at the whole catalogue. */
export async function readSurvivorReport(stellata: Stellata): Promise<SurvivorReport | null> {
  const counts = await stellata.readSurvivorCounts();
  if (counts === null) return null;
  return survivorReport(counts, stellata.catalog.count);
}
