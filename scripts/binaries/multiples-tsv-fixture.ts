// Test-only multiples.tsv text: one row from the cells a test names, every closed column defaulted.

import { MULTIPLES_COLUMNS } from './multiples-tsv';

type Cells = Partial<Record<(typeof MULTIPLES_COLUMNS)[number], string>>;

const DEFAULTS: Cells = {
  system_id: '00001+0001-AB', comp: 'A', source: 'wds', regime: '0', astrometry_via: 'gaia_5p',
  orbit_via: 'none', spect_via: 'none', photometry_via: 'none', a_via: 'none', orbit_role: 'primary',
};

export const MULTIPLES_HEADER = MULTIPLES_COLUMNS.join('\t');

/** A Gaia source or HIP given without its origin is the row's own; a Gaia source without
 *  its tier is `simbad_xid`, none `unresolved`. */
export function multiplesLine(cells: Cells): string {
  const own = (id: string | undefined): string => (id === undefined || id === '' ? '' : 'own');
  const via = own(cells.gaia_source_id) === '' ? 'unresolved' : 'simbad_xid';
  const row: Cells = {
    ...DEFAULTS, gaia_origin: own(cells.gaia_source_id), hip_origin: own(cells.hip), resolve_via: via, ...cells,
  };
  return MULTIPLES_COLUMNS.map((c) => row[c] ?? '').join('\t');
}
