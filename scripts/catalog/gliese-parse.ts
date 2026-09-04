// Parser and per-record lookup for data/gliese/gliese_v70a.tsv — the printed
// first-order tier under Tycho-2 in the V cascade of
// docs/catalog-driver.md § 5.

import { dataRows, nonEmpty, parseFloatOrNull } from './parse/corpus-tsv';
import { normaliseGjKey } from './catalog-pure';

const FILE_LABEL = 'data/gliese/gliese_v70a.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:gliese`.';

const COLUMNS = [
  'name', 'comp', 'vmag', 'bv', 'sp', 'plx_mas', 'e_plx_mas', 'n_plx',
] as const;

/** V/70A's resulting parallax, carrying which KIND of parallax it is.
 *
 *  `trigonometric` is `n_plx` blank — the catalogue stating that its resulting
 *  parallax is the trigonometric one. Every code the column carries (`r` `w`
 *  `s` `o` `p`) names a photometric or spectroscopic estimate instead, and the
 *  split is close to even over the catalogue. The flag travels with the value
 *  because the two are separate tiers of the parallax cascade sitting on either
 *  side of SIMBAD, so a consumer that ignored it would silently invert an
 *  estimate as though it were a measurement — see
 *  `data/gliese/README.md` § The parallax is half the column. */
export interface GlieseParallax {
  mas: number;
  errMas: number | null;
  trigonometric: boolean;
}

export interface GlieseRow {
  /** The catalogue entry's own name, prefix included (`Gl 559`, `NN 3417`). */
  name: string;
  /** Component letters this entry covers: `A`, `AB`, or empty. */
  comp: string;
  vMag: number | null;
  bMinusV: number | null;
  spectral: string | null;
  parallax: GlieseParallax | null;
}

export interface GlieseIndex {
  byKey: Map<string, GlieseRow>;
  rowCount: number;
}

export function emptyGlieseIndex(): GlieseIndex {
  return { byKey: new Map(), rowCount: 0 };
}

/** V/70A numbers its entries under four prefixes — `Gl` (1,745), `NN` (1,388),
 *  `GJ` (384) and `Wo` (285) — where a record's own `gl` cell carries only the
 *  `Gl` / `GJ` pair. The GJ 3xxx and 4xxx numbers this tier exists for are
 *  printed `NN nnnn`, so keying on the prefix would miss every one of them and
 *  the bare number is what the two sides can agree on. `normaliseGjKey` is the
 *  record side of the same reduction. */
function catalogueKey(name: string, comp: string): string | null {
  const bare = name.trim().replace(/^(Gl|GJ|NN|Wo)\s+/i, '').replace(/\s+/g, '');
  if (!bare) return null;
  return `${bare}${comp.trim().replace(/\s+/g, '')}`.toUpperCase();
}

/** Index V/70A on bare number + component. Exact `number+comp` keys are laid
 *  down first and a repeat throws — two rows claiming one component is an
 *  upstream change, not a binding to arbitrate silently. Only then do the
 *  derived keys fill in around them: a blend row's per-letter aliases (`Gl 165`
 *  `AB` answers to `165A`) and the bare number. Derived keys never displace an
 *  exact one, so `Gl 559 A` keeps `559A` even though a hypothetical `AB` row
 *  would alias onto it. */
export function parseGlieseTsv(text: string): GlieseIndex {
  const index = emptyGlieseIndex();
  const parsed: Array<{ key: string; row: GlieseRow }> = [];

  for (const { cells, idx } of dataRows(text, COLUMNS, FILE_LABEL, REFRESH_HINT)) {
    const name = (cells[idx.name] ?? '').trim();
    const comp = (cells[idx.comp] ?? '').trim();
    const key = catalogueKey(name, comp);
    if (key === null) continue;
    const plxMas = parseFloatOrNull(cells[idx.plx_mas]);
    const row: GlieseRow = {
      name,
      comp,
      vMag: parseFloatOrNull(cells[idx.vmag]),
      bMinusV: parseFloatOrNull(cells[idx.bv]),
      spectral: nonEmpty(cells[idx.sp]),
      parallax: plxMas === null ? null : {
        mas: plxMas,
        errMas: parseFloatOrNull(cells[idx.e_plx_mas]),
        // A blank `n_plx` is V/70A stating that its resulting parallax IS the
        // trigonometric one; every code the column carries names a photometric
        // or spectroscopic estimate.
        trigonometric: nonEmpty(cells[idx.n_plx]) === null,
      },
    };
    if (index.byKey.has(key)) {
      throw new Error(`${FILE_LABEL} has two rows keyed ${key}. ${REFRESH_HINT}`);
    }
    index.byKey.set(key, row);
    parsed.push({ key, row });
    index.rowCount++;
  }

  for (const { row } of parsed) {
    const bare = catalogueKey(row.name, '');
    if (bare === null) continue;
    for (const letter of row.comp.trim()) {
      const alias = `${bare}${letter}`.toUpperCase();
      if (!index.byKey.has(alias)) index.byKey.set(alias, row);
    }
    if (!index.byKey.has(bare)) index.byKey.set(bare, row);
  }

  return index;
}

/** The record's V/70A entry, keyed on its own `gl` cell. A cell naming a
 *  component V/70A did not resolve falls back to the system entry — `Gl 165A`
 *  reaches the `Gl 165 AB` row — which is why every tier reading this must
 *  treat the value as a system blend (`vTierIsSystemBlend`). */
export function lookupGliese(index: GlieseIndex, gl: string | null): GlieseRow | null {
  const key = normaliseGjKey(gl);
  if (key === null) return null;
  const exact = index.byKey.get(key);
  if (exact !== undefined) return exact;
  const bare = key.replace(/[A-Z]+$/, '');
  return bare === key ? null : index.byKey.get(bare) ?? null;
}
