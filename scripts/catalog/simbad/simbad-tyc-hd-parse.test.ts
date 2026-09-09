import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, it, expect } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { dataRows } from '../parse/corpus-tsv';
import { parseTyc2HdTsv } from '../classic-ids/classic-ids-parse';
import {
  MEMBERSHIP_MANIFEST_FILE,
  parseManifestTsv,
} from '../membership/membership-manifest-pure';
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
const AT = (f: string): string => resolve(REPO_ROOT, f);
const SRC_SIMBAD_TYC_HD = AT(SIMBAD_TYC_HD_FILE);
const SRC_TYC2_HD = AT(TYC2_HD_FILE);
const SRC_MANIFEST = AT(MEMBERSHIP_MANIFEST_FILE);
const ADJUDICATION_INPUTS = [SRC_SIMBAD_TYC_HD, SRC_TYC2_HD, SRC_MANIFEST];

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
      for (const row of parseTyc2HdTsv(readFileSync(SRC_TYC2_HD, 'utf-8'))) {
        const entry = iv.get(row.tyc) ?? { hd: new Set<number>(), consistent: true };
        entry.hd.add(row.hd);
        entry.consistent = entry.consistent && row.nHd === 1 && row.nTyc === 1;
        iv.set(row.tyc, entry);
      }
      simbad = parseSimbadTycHdTsv(readFileSync(SRC_SIMBAD_TYC_HD, 'utf-8'));

      counts = {
        bothCells: 0, answered: 0, silent: 0,
        dissent: 0, dissentInconsistent: 0, faithful: 0, vindicating: 0,
        bothAgainst: 0,
      };
      for (const row of parseManifestTsv(readFileSync(SRC_MANIFEST, 'utf-8'))) {
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
      expect(counts.bothCells).toBe(353352);
      expect(counts.answered).toBe(331739);
      expect(counts.silent).toBe(21613);
    });

    it('finds 220 dissents, every one on an internally consistent IV/25 entry', () => {
      expect(counts.dissent).toBe(220);
      expect(counts.dissentInconsistent).toBe(0);
    });

    it('splits them 210 manifest-faithful / 10 vindicating the manifest', () => {
      expect(counts.faithful).toBe(210);
      expect(counts.vindicating).toBe(10);
      expect(counts.faithful + counts.vindicating).toBe(counts.dissent);
    });

    // 23 before the eight rows the four-witness rule licensed were asserted
    // (README.md § Which witness decides a close pair's HD). What is left is
    // the twelve the rule refuses, the two it cannot answer for, and α Psc,
    // whose correction is held back — see the move set's own comment.
    it('finds 15 rows both witnesses contradict', () => {
      expect(counts.bothAgainst).toBe(15);
    });

    it('reproduces the two dissents measured by hand against live SIMBAD', () => {
      expect(hdNumbers(simbad.get('1066-3553-1')!)).toEqual([187260]);
      expect(hdNumbers(simbad.get('2772-917-1')!)).toEqual([224636]);
    });
  },
);

const SRC_SIMBAD_SPTYPE = AT('data/simbad/simbad_sptype.tsv');
const SPLIT_INPUTS = [...ADJUDICATION_INPUTS, SRC_SIMBAD_SPTYPE];

/** The move set of README.md § Which witness decides a close pair's HD: the
 *  rows all four witnesses agree the record's own component is not the one its
 *  HD cell names. Enumerated rather than counted, because the assertion those
 *  rows license moves canonical SID keys and each has to be inspected.
 *
 *  **Eight of the nine are asserted and so no longer contested.** α Psc is the
 *  one left, and it stays until promotion's twin guard stops keying on the
 *  anchor's Bayer letter: correcting the record to HD 12447 letters the anchor
 *  A, the guard stops firing on the 02020+0246-AB row, and the row mints a copy
 *  of its own anchor. An empty set here means that landed and the rule has no
 *  remaining reach. */
const FOUR_WITNESS_MOVE = ['40-1338-1'];

/** No SIMBAD object for the record's own source, so the fourth witness is
 *  silent and the rule leaves the row alone. */
const FOUR_WITNESS_SILENT = ['2604-1777-1', '8568-3121-1'].sort();

describe.skipIf(!SPLIT_INPUTS.every(lfsContentReadable))('the four-witness split', () => {
  let move: string[];
  let refuse: string[];
  let silent: string[];

  beforeAll(() => {
    const iv = new Map<string, Set<number>>();
    for (const row of parseTyc2HdTsv(readFileSync(SPLIT_INPUTS[1], 'utf-8'))) {
      const at = iv.get(row.tyc);
      if (at === undefined) iv.set(row.tyc, new Set([row.hd]));
      else at.add(row.hd);
    }
    const simbad = parseSimbadTycHdTsv(readFileSync(SPLIT_INPUTS[0], 'utf-8'));

    // The rows both TYC witnesses contradict — § What it adjudicates' 23.
    // Keyed on the TYC, not the source: a mutual swap is two rows.
    const contested = new Map<string, string>();
    for (const row of parseManifestTsv(readFileSync(SPLIT_INPUTS[2], 'utf-8'))) {
      const tyc = row.tyc.trim();
      const shipped = Number.parseInt(row.hd.trim(), 10);
      const answer = simbad.get(tyc);
      const printed = iv.get(tyc);
      if (tyc === '' || !Number.isFinite(shipped) || answer === undefined) continue;
      if (printed === undefined) continue;
      const stated = hdNumbers(answer);
      if (!stated.some((hd) => printed.has(hd))) continue;
      if (stated.includes(shipped) || printed.has(shipped)) continue;
      contested.set(tyc, row.gaia_source_id);
    }

    // The fourth witness: SIMBAD's object for the record's own Gaia source.
    // Header-keyed, like every other reader of this table — a positional
    // column index reads a neighbouring cell after a re-pull reorders it.
    const sources = new Set([...contested.values()].filter((s) => s !== ''));
    const objectOfSource = new Map<string, string>();
    for (const { cells, idx } of dataRows(
      readFileSync(SRC_SIMBAD_SPTYPE, 'utf-8'),
      ['source_id', 'simbad_main_id'],
      'simbad_sptype.tsv',
      'Re-run `pnpm run refresh:simbad-sptype`.',
    )) {
      const sourceId = cells[idx.source_id];
      if (sources.has(sourceId)) objectOfSource.set(sourceId, cells[idx.simbad_main_id]);
    }

    move = [];
    refuse = [];
    silent = [];
    for (const [tyc, sourceId] of contested) {
      const ofSource = sourceId === '' ? undefined : objectOfSource.get(sourceId);
      if (ofSource === undefined) silent.push(tyc);
      else if (ofSource === simbad.get(tyc)!.mainId) move.push(tyc);
      else refuse.push(tyc);
    }
    for (const list of [move, refuse, silent]) list.sort();
  });

  it('splits the remaining contested rows one / twelve / two', () => {
    expect(move.length + refuse.length + silent.length).toBe(15);
    expect(move).toEqual(FOUR_WITNESS_MOVE);
    expect(silent).toEqual(FOUR_WITNESS_SILENT);
    expect(refuse).toHaveLength(12);
  });

  // ε Boo is why the rule is not "prefer the own-TYC HD": IV/25, SIMBAD and
  // I/239 all call TYC 2019-1250-1 HD 129988 (ε Boo B), and the record's own
  // source is Izar. A TYC-keyed rule ships Izar under its companion's number.
  it('refuses ε Bootis, whose TYC cell is the crossed one', () => {
    expect(refuse).toContain('2019-1250-1');
  });
});
