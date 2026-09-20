// The V floor, the verdict it takes on a Gaia magnitude-pull row, and the
// union's dedupe. See README.md.

import { headerIndex } from '../../parse/corpus-tsv';
import { rielloVMagnitude } from '../../photometry/v-magnitude-pure';
import type { GaiaPhotometry } from '../../photometry/gaia-photometry-pure';

export const MAGNITUDE_PULL_FILE = 'data/gaia/gaia_dr3_magnitude_pull.tsv';

/** Johnson V the term admits on; `null` is the primaries alone.
 *  README.md § The floor is one constant. */
export const MAGNITUDE_FLOOR_V: number | null = null;

/** Raising MAGNITUDE_FLOOR_V past this needs a re-pull first —
 *  README.md § The floor is one constant. */
export const MAGNITUDE_PULL_G_BOUND = 11;

const PULL_COLUMNS = [
  'source_id', 'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag',
] as const;

export const MAGNITUDE_PULL_HINT = 'run `pnpm run refresh:gaia-magnitude`.';

/** README.md § The filter is the shipped cascade's own top tier. */
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

/** Line-fed, so the whole-text filter and the streaming reader share one
 *  implementation over a ~200 MB table. */
export function magnitudeTermAccumulator(floorV: number): {
  line: (raw: string) => void;
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
  let idx: Record<string, number> | null = null;
  const keptSourceIds = new Set<string>();
  const counts: MagnitudeTermCounts = { rows: 0, kept: 0, above_floor: 0, no_v: 0 };

  const cell = (cells: string[], column: string): number | null => {
    const raw = (cells[idx![column]] ?? '').trim();
    if (!raw) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  };

  return {
    line: (raw) => {
      if (idx === null) {
        idx = headerIndex(raw, PULL_COLUMNS, MAGNITUDE_PULL_FILE, MAGNITUDE_PULL_HINT);
        return;
      }
      if (!raw.trim()) return;
      const cells = raw.split('\t');
      const sourceId = (cells[idx.source_id] ?? '').trim();
      if (!sourceId) return;
      counts.rows++;
      const verdict = magnitudeVerdict(
        {
          gMag: cell(cells, 'phot_g_mean_mag'),
          bpMag: cell(cells, 'phot_bp_mean_mag'),
          rpMag: cell(cells, 'phot_rp_mean_mag'),
        },
        floorV,
      );
      counts[verdict]++;
      if (verdict === 'kept') keptSourceIds.add(sourceId);
    },
    result: () => ({ keptSourceIds, counts }),
  };
}

export function selectMagnitudeTerm(text: string, floorV: number): MagnitudeTermSelection {
  const acc = magnitudeTermAccumulator(floorV);
  for (const line of text.split(/\r?\n/)) acc.line(line);
  return acc.result();
}

/** A manifest row the magnitude term contributed, carrying the source_id the
 *  record build's astrometry read keys on. */
export function isMagnitudeTermRow(
  row: { term: string; gaia_source_id: string },
): boolean {
  return row.term === 'magnitude' && row.gaia_source_id !== '';
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
