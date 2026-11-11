// The records stage's count block over the sorted records, and the variability units each record writes. See README.md.

import { encodeAmpUnits, encodePeriodUnits } from '../../../src/catalog-format/record/catalog-pure';

/** The records stage's count block. */
export type RecordsCounts = {
  /** Records written to catalog.bin after filtering and sort. */
  recordCount: number;
  /** Records the first transport chunk carries — what first paint draws
   *  (`/src/catalog-format/record/README.md#on-disk-transport-chunking`). */
  recordsInFirstChunk: number;
  /** Records carrying a source_id the committed Apsis / GSPC pull holds no row
   *  for. Pinned at the reviewed residual rather than zero: Gaia genuinely
   *  publishes no parameters for part of the catalogue, so what is gated is the
   *  shortfall MOVING (../../refresh/README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator). */
  apsisSourcesUnpulled: number;
  gspcSourcesUnpulled: number;
  /** Stars with both nonzero amplitude and period after quantisation —
   *  drives the shader's "is variable" sentinel. */
  variableCount: number;
  /** Records emitted with a non-zero Gaia DR3 source_id at
   *  RECORD_LAYOUT.gaiaSourceId. The manifest carries one on all but its
   *  no-Gaia residual; a sharp drop here means the builder lost the
   *  plumbing, since nothing re-derives the binding. */
  gaiaSourceIdResolved: number;
  /** Catalog records whose `gaia_source_id` resolves to an ApsisRow —
   *  upper bound on per-record Apsis coverage. */
  apsisMatched: number;
  /** Records with a non-null Teff in either gspphot OR gspspec — the
   *  population the downstream Tier 2 colour-LUT re-routing can use as
   *  Apsis-direct Teff. */
  apsisTeffEither: number;
};

export interface RecordsStageRecord {
  readonly gaiaSourceId: string | null;
  readonly periodDays: number;
  readonly amplitudeMag: number;
}

interface ApsisTeff {
  readonly teffGspphot: number | null;
  readonly teffGspspec: number | null;
}

/** A record's quantised amplitude and period; both zero unless GCVS gave it a period and an amplitude. */
export function variabilityUnits(r: Pick<RecordsStageRecord, 'periodDays' | 'amplitudeMag'>): { ampUnits: number; periodUnits: number } {
  if (!(r.periodDays > 0 && r.amplitudeMag > 0)) return { ampUnits: 0, periodUnits: 0 };
  return { ampUnits: encodeAmpUnits(r.amplitudeMag), periodUnits: encodePeriodUnits(r.periodDays) };
}

export function recordsCounts(
  records: readonly RecordsStageRecord[],
  apsis: ReadonlyMap<string, ApsisTeff>,
  gspc: ReadonlyMap<string, unknown>,
  recordsInFirstChunk: number,
): RecordsCounts {
  const counts: RecordsCounts = {
    recordCount: records.length,
    recordsInFirstChunk,
    apsisSourcesUnpulled: 0,
    gspcSourcesUnpulled: 0,
    variableCount: 0,
    gaiaSourceIdResolved: 0,
    apsisMatched: 0,
    apsisTeffEither: 0,
  };
  for (const r of records) {
    const { ampUnits, periodUnits } = variabilityUnits(r);
    if (ampUnits > 0 && periodUnits > 0) counts.variableCount++;
    if (r.gaiaSourceId === null) continue;
    counts.gaiaSourceIdResolved++;
    const row = apsis.get(r.gaiaSourceId);
    if (row === undefined) counts.apsisSourcesUnpulled++;
    else {
      counts.apsisMatched++;
      if (row.teffGspphot !== null || row.teffGspspec !== null) counts.apsisTeffEither++;
    }
    if (!gspc.has(r.gaiaSourceId)) counts.gspcSourcesUnpulled++;
  }
  return counts;
}

export function apsisCoverageSummary(c: RecordsCounts): string {
  const pct = (n: number) => ((n / c.recordCount) * 100).toFixed(1);
  return `Gaia DR3 Apsis: ${c.apsisMatched} / ${c.recordCount} records matched (${pct(c.apsisMatched)}%), `
    + `Teff (gspphot OR gspspec) on ${c.apsisTeffEither} (${pct(c.apsisTeffEither)}%)`;
}
