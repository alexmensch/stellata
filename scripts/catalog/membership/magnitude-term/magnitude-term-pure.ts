// The V floor, the verdict it takes on a Gaia magnitude-pull row, and the
// union's dedupe. See README.md.

import type { ManifestRecord } from '../membership-manifest-tsv';
import {
  readTable, tableLineReader, type TableRow, type TableSpec,
} from '../../../util/tsv/table-pure';
import { rielloVMagnitude } from '../../photometry/v-magnitude-pure';
import type { GaiaPhotometry } from '../../photometry/gaia-photometry-pure';

export const MAGNITUDE_PULL_FILE = 'data/gaia/gaia_dr3_magnitude_pull.tsv';

/** Johnson V the term admits on; `null` is the primaries alone.
 *  README.md#the-floor-is-one-constant. */
export const MAGNITUDE_FLOOR_V: number | null = 11;

/** Raising MAGNITUDE_FLOOR_V past this needs a re-pull first —
 *  README.md#the-floor-is-one-constant. */
export const MAGNITUDE_PULL_G_BOUND = 11;

export const MAGNITUDE_PULL_HINT = 'run `pnpm run refresh:gaia-magnitude`.';

const MAGNITUDE_PULL = {
  file: MAGNITUDE_PULL_FILE,
  columns: ['source_id', 'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag'] as const,
  hint: MAGNITUDE_PULL_HINT,
} satisfies TableSpec<string>;

type PullRow = TableRow<(typeof MAGNITUDE_PULL.columns)[number]>;

/** README.md#the-filter-is-the-shipped-cascades-own-top-tier. */
export const MAGNITUDE_VERDICTS = ['kept', 'above_floor', 'no_v'] as const;
export type MagnitudeVerdict = (typeof MAGNITUDE_VERDICTS)[number];

export function magnitudeVerdict(
  photometry: GaiaPhotometry | null,
  floorV: number,
): MagnitudeVerdict {
  const v = rielloVMagnitude(photometry);
  if (v === null) return 'no_v';
  return v <= floorV ? 'kept' : 'above_floor';
}

export type MagnitudeTermCounts = Record<MagnitudeVerdict | 'rows', number>;

export interface MagnitudeTermSelection {
  /** Every `source_id` the floor keeps, insertion-ordered by the pull. */
  keptSourceIds: Set<string>;
  counts: MagnitudeTermCounts;
}

function magnitudeTermFold(floorV: number): {
  fold: (row: PullRow) => void;
  result: () => MagnitudeTermSelection;
} {
  if (!Number.isFinite(floorV)) {
    throw new Error(`magnitude floor must be finite, got ${floorV}`);
  }
  if (floorV > MAGNITUDE_PULL_G_BOUND) {
    throw new Error(
      `magnitude floor V <= ${floorV} exceeds the pull's G <= ${MAGNITUDE_PULL_G_BOUND} `
        + `bound, so the selection would be incomplete — re-pull deeper first: ${MAGNITUDE_PULL_HINT}`,
    );
  }
  const keptSourceIds = new Set<string>();
  const counts: MagnitudeTermCounts = { rows: 0, kept: 0, above_floor: 0, no_v: 0 };

  return {
    fold: (row) => {
      const sourceId = row.sourceId('source_id');
      if (sourceId === null) return;
      counts.rows++;
      const verdict = magnitudeVerdict(
        {
          gMag: row.float('phot_g_mean_mag'),
          bpMag: row.float('phot_bp_mean_mag'),
          rpMag: row.float('phot_rp_mean_mag'),
        },
        floorV,
      );
      counts[verdict]++;
      if (verdict === 'kept') keptSourceIds.add(sourceId);
    },
    result: () => ({ keptSourceIds, counts }),
  };
}

/** Line-fed, so the streaming reader over the ~200 MB pull folds rows
 *  exactly as the whole-text filter does. */
export function magnitudeTermAccumulator(floorV: number): {
  line: (raw: string) => void;
  result: () => MagnitudeTermSelection;
} {
  const { fold, result } = magnitudeTermFold(floorV);
  return { line: tableLineReader(MAGNITUDE_PULL, fold), result };
}

export function selectMagnitudeTerm(text: string, floorV: number): MagnitudeTermSelection {
  const { fold, result } = magnitudeTermFold(floorV);
  for (const row of readTable(MAGNITUDE_PULL, text)) fold(row);
  return result();
}

/** The source_id the record build's astrometry read keys on, for a manifest
 *  row the magnitude term contributed; null for any other row. */
export function magnitudeTermSourceId(
  row: Pick<ManifestRecord, 'term' | 'gaiaSourceId'>,
): string | null {
  return row.term === 'magnitude' ? row.gaiaSourceId : null;
}

export function magnitudeTermNewcomers(
  keptSourceIds: ReadonlySet<string>,
  boundSourceIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const sourceId of keptSourceIds) {
    if (!boundSourceIds.has(sourceId)) out.push(sourceId);
  }
  return out;
}
