// The § 6.1 dropped list: its committed shape, its closed reason enum, and the
// identifier key the parity gate matches it on.
// See README.md § Why the residual drops rather than degrading.

/** Where the ledger is committed — beside the additions ledger it is the
 *  counterpart to, keyed on the same five identifier cells. */
export const PARKED_LEDGER_FILE = 'data/membership/parked-ledger.tsv';

/** The closed enum § 6.1 requires, for this membership event.
 *  `refused_no_defensible_parallax` is a row whose only measurement a skip rule
 *  refused; `no_parallax_published` is a row nothing ever measured. The two
 *  have different futures — the first reinstates when Gaia DR4 fits the blend,
 *  the second needs someone to measure the star. `no_v_magnitude` is a row
 *  placed but unlit: no V tier reaches it, and a record needs both.
 *  `no_position` is the mirror of that last one — lit, and given a distance by
 *  a bound sibling, but no direction tier states where on the sky it is, so
 *  there is nothing to multiply the distance by. */
export const PARKED_REASONS = [
  'refused_no_defensible_parallax',
  'no_parallax_published',
  'no_v_magnitude',
  'no_position',
] as const;

export type ParkedReason = (typeof PARKED_REASONS)[number];

/** One manifest row the walk could not ship. Records leave the catalogue
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

/** The five identifier cells, joined — the manifest carries all of them under
 *  the same names, so the parity gate matches ledger row to manifest row on the
 *  whole tuple rather than guessing which id is the one that identifies. */
export function parkedRecordKey(cells: {
  tyc: string; hip: string; hd: string; gl: string; gaia_source_id: string;
}): string {
  return [cells.tyc, cells.hip, cells.hd, cells.gl, cells.gaia_source_id].join('\t');
}

export function formatParkedRecordsTsv(parked: readonly ParkedRecord[]): string {
  // Sorted on the whole row, not on `tyc` alone: a park with no TYC would tie
  // with every other and leave the file's order a function of the walk. The
  // committed file is diffed in CI, so a reordering that moves no row would
  // read as a change.
  const lines = parked.map((p) => [
    p.tyc ?? '', p.hip ?? '', p.hd ?? '', p.gl ?? '', p.gaiaSourceId ?? '', p.reason,
  ].join('\t')).sort();
  return [COLUMNS.join('\t'), ...lines].join('\n') + '\n';
}

export interface ParkedLedgerRow {
  recordKey: string;
  reason: string;
}

export function parseParkedRecordsTsv(text: string): ParkedLedgerRow[] {
  const [header, ...lines] = text.trimEnd().split('\n');
  if (header !== COLUMNS.join('\t')) {
    throw new Error(`${PARKED_LEDGER_FILE}: unexpected header "${header}"`);
  }
  return lines.filter((line) => line !== '').map((line) => {
    const [tyc, hip, hd, gl, gaia_source_id, reason] = line.split('\t');
    return {
      recordKey: parkedRecordKey({ tyc, hip, hd, gl, gaia_source_id }),
      reason,
    };
  });
}
