// The § 6.1 dropped list for records no owned parallax reaches: its committed
// shape, its closed reason enum, and the spine key the parity gate matches it
// on. See README.md § Why the residual drops rather than degrading.

/** Where the ledger is committed. */
export const PARKED_RECORDS_FILE = 'data/athyg/parked_no_owned_parallax.tsv';

/** The closed enum § 6.1 requires, for this membership event.
 *  `refused_no_defensible_parallax` is a row whose only measurement a skip rule
 *  refused; `no_parallax_published` is a row nothing ever measured. The two
 *  have different futures — the first reinstates when Gaia DR4 fits the blend,
 *  the second needs someone to measure the star. */
export const PARKED_REASONS = [
  'refused_no_defensible_parallax',
  'no_parallax_published',
] as const;

export type ParkedReason = (typeof PARKED_REASONS)[number];

/** One spine row the cascade could not place. Records leave the catalogue
 *  entirely, so nothing else in the build records that they existed. */
export interface ParkedRecord {
  tyc: string | null;
  hip: number | null;
  hd: number | null;
  gl: string | null;
  gaiaSourceId: string | null;
  reason: ParkedReason;
}

const COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const;

/** The five identifier cells, joined — the spine carries all of them under the
 *  same names, so the parity gate matches ledger row to spine row on the whole
 *  tuple rather than guessing which id is the one that identifies. */
export function parkedSpineKey(cells: {
  tyc: string; hip: string; hd: string; gl: string; gaia_source_id: string;
}): string {
  return [cells.tyc, cells.hip, cells.hd, cells.gl, cells.gaia_source_id].join('\t');
}

export function formatParkedRecordsTsv(parked: readonly ParkedRecord[]): string {
  // Sorted on the whole row, not on `tyc` alone: every row carries a TYC today,
  // but a park with none would tie with every other and leave the file's order
  // a function of the spine walk. The committed file is diffed in CI, so a
  // reordering that moves no row would read as a change.
  const lines = parked.map((p) => [
    p.tyc ?? '', p.hip ?? '', p.hd ?? '', p.gl ?? '', p.gaiaSourceId ?? '', p.reason,
  ].join('\t')).sort();
  return [COLUMNS.join('\t'), ...lines].join('\n') + '\n';
}

export interface ParkedLedgerRow {
  spineKey: string;
  reason: string;
}

export function parseParkedRecordsTsv(text: string): ParkedLedgerRow[] {
  const [header, ...lines] = text.trimEnd().split('\n');
  if (header !== COLUMNS.join('\t')) {
    throw new Error(`${PARKED_RECORDS_FILE}: unexpected header "${header}"`);
  }
  return lines.filter((line) => line !== '').map((line) => {
    const [tyc, hip, hd, gl, gaia_source_id, reason] = line.split('\t');
    return {
      spineKey: parkedSpineKey({ tyc, hip, hd, gl, gaia_source_id }),
      reason,
    };
  });
}
