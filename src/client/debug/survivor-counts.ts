// debug.survivors(). README.md § Survivor counts.

import type { Stellata } from '../stellata';
import type { SurvivorCounts } from '../webgpu/star/compaction/compaction-pure';

/** The compaction's counters plus the refill's in-frame population, which
 *  the shell composes (`Stellata.readSurvivorCounts`). `inFrame` is null
 *  where the refill has no view yet. */
export interface SurvivorCountsRead extends SurvivorCounts {
  inFrame: number | null;
}

export interface SurvivorReport extends SurvivorCountsRead {
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
  /** Stars the refill's frustum test admits, over records — the population
   *  that pays the gate's reads. Null where `inFrame` is. */
  inFrameFraction: number | null;
}

export function survivorReport(counts: SurvivorCountsRead, records: number): SurvivorReport {
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
    inFrameFraction: counts.inFrame === null ? null : per(counts.inFrame),
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
    r.inFrame === null || r.inFrameFraction === null
      ? '  in the refill frustum: no view yet'
      : `  in the refill frustum ${r.inFrame} (${survivorPct(r.inFrameFraction)})`,
  ].join('\n');
}

/** Null on a WebGL2 boot, which lists no survivors — its three draws are
 *  priced at the whole catalogue. */
export async function readSurvivorReport(stellata: Stellata): Promise<SurvivorReport | null> {
  const counts = await stellata.readSurvivorCounts();
  if (counts === null) return null;
  return survivorReport(counts, stellata.catalog.count);
}
