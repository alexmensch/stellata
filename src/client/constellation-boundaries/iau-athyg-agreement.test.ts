// Catalogue-wide cross-check of the IAU-positional assignment against AT-HYG's
// own editorial `con` column. See README.md § Agreement with AT-HYG.

import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CON_INDEX,
  readIauEdgeRecords,
} from '../../../scripts/catalog/parse/constellations';
import { ATHYG_CSV } from '../../../scripts/catalog/parse/read-stars-inputs';
import { isLfsPointerFile } from '../../../scripts/util/paths';
import { B1875_JD, precessRaDec, precessionRotationFromJ2000 } from '../util/precession';
import {
  buildConstellationRegions,
  constellationEdgeCodeAt,
  constellationKey,
  parseIauEdges,
} from './iau-boundaries-pure';

/** AT-HYG rows carrying a `con` cell. Sol is the one row that does not. */
const ROWS_WITH_CON = 317_174;

/** Rows where the positional assignment and AT-HYG's editorial column differ.
 *  Pinned exactly, not as a rate: this count is the sharpest available signal
 *  on the precession epoch — dating B1875.0 six months late triples it. */
const DISAGREEMENTS = 61;

const HOURS_TO_DEG = 15;

const B1875 = precessionRotationFromJ2000(B1875_JD);
const grid = buildConstellationRegions(parseIauEdges(readIauEdgeRecords()));

interface Disagreement {
  hip: string;
  designation: string;
  athygCon: string;
  positionalCon: string;
}

// The CSV rides LFS: the bare CI `test` job sees a pointer stub, so the sweep
// runs in the build-catalog job (lfs: true) and in any local clone.
const available = !isLfsPointerFile(ATHYG_CSV);

describe.skipIf(!available)('IAU-positional assignment vs the AT-HYG con column', () => {
  let rowsWithCon = 0;
  const disagreements: Disagreement[] = [];

  // Parsed here, not in the describe body: a skipped suite still runs its body
  // to collect tests, and this is a 67 MB walk.
  beforeAll(async () => {
    const rows = createReadStream(ATHYG_CSV).pipe(
      parse({ columns: true, skip_empty_lines: true, cast: false }),
    ) as AsyncIterable<Record<string, string>>;

    for await (const row of rows) {
      const athygCon = row.con.trim();
      if (!athygCon) continue;
      rowsWithCon++;
      const positional = constellationKey(constellationEdgeCodeAt(
        grid,
        precessRaDec(B1875, {
          raDeg: Number(row.ra) * HOURS_TO_DEG,
          decDeg: Number(row.dec),
        }),
      ));
      if (positional === athygCon.toLowerCase()) continue;
      disagreements.push({
        hip: row.hip,
        designation: [row.proper, row.bayer, row.flam].map((s) => s.trim()).filter(Boolean).join(' '),
        athygCon,
        positionalCon: positional,
      });
    }
  }, 300_000);

  it('walks every row that carries a constellation', () => {
    expect(rowsWithCon).toBe(ROWS_WITH_CON);
  });

  it('agrees on all but a pinned handful of rows', () => {
    expect(disagreements).toHaveLength(DISAGREEMENTS);
    expect(1 - DISAGREEMENTS / ROWS_WITH_CON).toBeGreaterThan(0.9995);
  });

  // Every other disagreement is an anonymous row near a wall, where AT-HYG's
  // editorial cell has no nomenclature to answer to. This one carries a
  // designation, so making conIndex positional would silently rewrite its
  // search aliases — which is why the designation constellation is carried
  // separately. See README.md § ρ Aquilae.
  it('leaves rho Aql as the only designated star it moves', () => {
    const designated = disagreements.filter((d) => d.designation.length > 0);
    expect(designated).toEqual([
      { hip: '99742', designation: 'Rho 67', athygCon: 'Aql', positionalCon: 'del' },
    ]);
  });

  it('resolves every assignment into the IAU-88 table', () => {
    const keys = new Set(grid.cellCon.map(constellationKey));
    expect(keys.size).toBe(88);
    for (const key of keys) expect(CON_INDEX.get(key)).toBeTypeOf('number');
  });
});
