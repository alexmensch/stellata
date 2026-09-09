import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, it, expect } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../util/paths';
import { parseTyc2HdTsv } from './classic-ids/classic-ids-parse';
import {
  MEMBERSHIP_MANIFEST_FILE,
  parseManifestTsv,
} from './membership/membership-manifest-pure';
import {
  hdNumbers,
  parseSimbadTycHdTsv,
  type SimbadTycHdRow,
} from './simbad-tyc-hd-parse';

const HEADER = ['tyc', 'simbad_oid', 'simbad_main_id', 'hd'].join('\t');

function tsv(...rows: string[][]): string {
  return [HEADER, ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
}

describe('parseSimbadTycHdTsv', () => {
  it('indexes on the full TYC', () => {
    const index = parseSimbadTycHdTsv(tsv(
      ['7570-1585-1', '7426150', '* f Eri A', '24072'],
      ['7570-1586-1', '687096', '* f Eri B', '24071'],
    ));
    expect([...index.keys()]).toEqual(['7570-1585-1', '7570-1586-1']);
    expect(index.get('7570-1585-1')).toEqual({
      hdIdents: ['24072'], simbadOid: 7426150, mainId: '* f Eri A',
    });
  });

  it('keeps every HD a Tycho entry carries, in file order', () => {
    const row = parseSimbadTycHdTsv(
      tsv(['1-1-1', '9', '', '12447|12448']),
    ).get('1-1-1')!;
    expect(row.hdIdents).toEqual(['12447', '12448']);
  });

  it('preserves a component letter on the ident', () => {
    const row = parseSimbadTycHdTsv(
      tsv(['1-1-1', '9', '', '24071B']),
    ).get('1-1-1')!;
    expect(row.hdIdents).toEqual(['24071B']);
  });

  it('reads a blank main_id as null', () => {
    expect(parseSimbadTycHdTsv(tsv(['1-1-1', '9', '', '1'])).get('1-1-1')!.mainId)
      .toBeNull();
  });

  it('skips a row missing its key, oid or HD rather than indexing a partial', () => {
    const index = parseSimbadTycHdTsv(tsv(
      ['', '9', 'x', '1'],
      ['2-2-2', '', 'x', '1'],
      ['3-3-3', '9', 'x', ''],
      ['4-4-4', '9', 'x', '1'],
    ));
    expect([...index.keys()]).toEqual(['4-4-4']);
  });

  it('hard-fails on a header missing a column, so a truncated pull cannot read as empty', () => {
    expect(() => parseSimbadTycHdTsv('tyc\tsimbad_oid\n1-1-1\t9\n')).toThrow();
  });
});

describe('hdNumbers', () => {
  it('drops the component letter', () => {
    expect(hdNumbers({ hdIdents: ['24071B'], simbadOid: 1, mainId: null }))
      .toEqual([24071]);
  });

  it('deduplicates the bare and lettered forms of one number', () => {
    expect(hdNumbers({
      hdIdents: ['24071', '24071B'], simbadOid: 1, mainId: null,
    })).toEqual([24071]);
  });

  it('keeps two genuinely different numbers in first-seen order', () => {
    expect(hdNumbers({
      hdIdents: ['12448', '12447'], simbadOid: 1, mainId: null,
    })).toEqual([12448, 12447]);
  });

  it('contributes nothing for a suffix with no leading integer', () => {
    expect(hdNumbers({ hdIdents: ['A', ''], simbadOid: 1, mainId: null }))
      .toEqual([]);
  });
});

const SIMBAD_TYC_HD_FILE = 'data/simbad/simbad_tyc_hd.tsv';
const TYC2_HD_FILE = 'data/classic-ids/tyc2_hd.tsv';
const ADJUDICATION_INPUTS = [SIMBAD_TYC_HD_FILE, TYC2_HD_FILE, MEMBERSHIP_MANIFEST_FILE]
  .map((f) => resolve(REPO_ROOT, f));

// Pins data/simbad/README.md § What it adjudicates. The figures are the
// pull's whole justification, so they are asserted rather than narrated: a
// re-pull that moves one fails here instead of ageing that prose.
describe.skipIf(!ADJUDICATION_INPUTS.every(lfsContentReadable))(
  'adjudication over the committed tables',
  () => {
    // Read in beforeAll, never at collection: a skipped suite still evaluates
    // its body, so a pointer stub on a checkout without `git lfs pull` would
    // throw here rather than skip.
    let simbad: Map<string, SimbadTycHdRow>;
    let counts: Record<string, number>;

    beforeAll(() => {
      // IV/25 gives an `n_hd=2` entry ONE ROW PER HD, so the authority for a
      // TYC is the SET of its rows. Keying single-valued drops one and reads
      // SIMBAD's agreement with the other as a dissent — 7 phantom rows.
      const iv = new Map<string, { hd: Set<number>; consistent: boolean }>();
      for (const row of parseTyc2HdTsv(readFileSync(ADJUDICATION_INPUTS[1], 'utf-8'))) {
        const entry = iv.get(row.tyc) ?? { hd: new Set<number>(), consistent: true };
        entry.hd.add(row.hd);
        entry.consistent = entry.consistent && row.nHd === 1 && row.nTyc === 1;
        iv.set(row.tyc, entry);
      }
      simbad = parseSimbadTycHdTsv(readFileSync(ADJUDICATION_INPUTS[0], 'utf-8'));

      counts = {
        bothCells: 0, answered: 0, silent: 0,
        dissent: 0, dissentInconsistent: 0, faithful: 0, vindicating: 0,
        bothAgainst: 0,
      };
      for (const row of parseManifestTsv(readFileSync(ADJUDICATION_INPUTS[2], 'utf-8'))) {
        const tyc = row.tyc.trim();
        const shipped = Number.parseInt(row.hd.trim(), 10);
        if (tyc === '' || !Number.isFinite(shipped)) continue;
        counts.bothCells += 1;
        const answer = simbad.get(tyc);
        if (answer === undefined) { counts.silent += 1; continue; }
        counts.answered += 1;
        const printed = iv.get(tyc);
        if (printed === undefined) continue;
        const stated = hdNumbers(answer);
        if (!stated.some((hd) => printed.hd.has(hd))) {
          counts.dissent += 1;
          if (!printed.consistent) counts.dissentInconsistent += 1;
          else if (stated.includes(shipped)) counts.vindicating += 1;
          else if (printed.hd.has(shipped)) counts.faithful += 1;
        } else if (!stated.includes(shipped) && !printed.hd.has(shipped)) {
          counts.bothAgainst += 1;
        }
      }
    });

    it('answers for the stated share of the rows carrying both cells', () => {
      expect(counts.bothCells).toBe(353347);
      expect(counts.answered).toBe(331734);
      expect(counts.silent).toBe(21613);
    });

    it('finds 219 dissents, every one on an internally consistent IV/25 entry', () => {
      expect(counts.dissent).toBe(219);
      expect(counts.dissentInconsistent).toBe(0);
    });

    it('splits them 209 manifest-faithful / 10 vindicating the manifest', () => {
      expect(counts.faithful).toBe(209);
      expect(counts.vindicating).toBe(10);
      expect(counts.faithful + counts.vindicating).toBe(counts.dissent);
    });

    it('finds 23 rows both witnesses contradict', () => {
      expect(counts.bothAgainst).toBe(23);
    });

    it('reproduces the two dissents measured by hand against live SIMBAD', () => {
      expect(hdNumbers(simbad.get('1066-3553-1')!)).toEqual([187260]);
      expect(hdNumbers(simbad.get('2772-917-1')!)).toEqual([224636]);
    });
  },
);
