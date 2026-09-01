import { describe, it, expect } from 'vitest';

import {
  emptySimbadValueIndex,
  lookupSimbadValues,
  parseSimbadValuesTsv,
} from './simbad-values-parse';

const HEADER = [
  'simbad_oid', 'rvz_radvel', 'rvz_type', 'rvz_qual', 'rvz_bibcode',
  'ra', 'dec', 'coo_bibcode', 'pmra', 'pmdec', 'pm_bibcode',
  'plx_value', 'plx_err', 'plx_bibcode',
  'hip', 'source_id', 'tyc', 'gj',
].join('\t');

const row = (cells: Partial<Record<string, string>>) => [
  cells.oid ?? '1', cells.rv ?? '', cells.type ?? 'v', cells.qual ?? 'A',
  cells.bibcode ?? '',
  cells.ra ?? '', cells.dec ?? '', cells.cooBibcode ?? '',
  cells.pmra ?? '', cells.pmdec ?? '', cells.pmBibcode ?? '',
  cells.plx ?? '', cells.plxErr ?? '', cells.plxBibcode ?? '',
  cells.hip ?? '', cells.sourceId ?? '',
  cells.tyc ?? '', cells.gj ?? '',
].join('\t');

const tsv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const NO_KEYS = { sourceId: null, hip: null, tyc: null, gl: null };

describe('parseSimbadValuesTsv', () => {
  it('indexes a row under every namespace it carries', () => {
    const index = parseSimbadValuesTsv(tsv(row({
      rv: '-8.6', bibcode: '1953GCRV..C......0W',
      hip: '104417', sourceId: '1872008813630353024', tyc: '3168-56-1', gj: '9728 A',
    })));
    expect(index.rowCount).toBe(1);
    for (const keys of [
      { ...NO_KEYS, sourceId: '1872008813630353024' },
      { ...NO_KEYS, hip: 104417 },
      { ...NO_KEYS, tyc: '3168-56-1' },
      { ...NO_KEYS, gl: 'GJ 9728A' },
    ]) {
      expect(lookupSimbadValues(index, keys)?.rv)
        .toEqual({ kmS: -8.6, bibcode: '1953GCRV..C......0W' });
    }
  });

  // The pull drops the whole quantity where its bibcode is empty, so this
  // guards a re-pulled file rather than the committed one.
  it('drops an unbibcoded rv', () => {
    const index = parseSimbadValuesTsv(tsv(row({ rv: '12.5', hip: '1' })));
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 1 })?.rv).toBeNull();
  });

  // EGGR 252's shape: a redshift-typed quantity reading 243,879 km/s, which
  // on a catalogue bounded at 50 kpc is not a stellar line-of-sight velocity.
  it('drops a value rvz_type does not call a velocity', () => {
    const index = parseSimbadValuesTsv(tsv(row({
      rv: '243878.87', type: 'z', bibcode: '2009ApJS..182..543A', hip: '2',
    })));
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 2 })?.rv).toBeNull();
  });

  it('keeps a genuine zero', () => {
    const index = parseSimbadValuesTsv(tsv(row({ rv: '0', bibcode: 'X', hip: '3' })));
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 3 })?.rv?.kmS).toBe(0);
  });

  // The cascade takes `kmS` as finite without re-testing it, so the parser is
  // where a malformed cell has to become an absent value.
  it('drops a value no number parses out of', () => {
    const index = parseSimbadValuesTsv(tsv(
      row({ rv: '~', bibcode: 'X', hip: '4' }),
      row({ rv: 'NaN', bibcode: 'X', hip: '5' }),
    ));
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 4 })?.rv).toBeNull();
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 5 })?.rv).toBeNull();
  });

  // The pull also enumerates by SIMBAD oid, so a row carrying none of the four
  // ids is legitimate — unjoinable, but still a row the count must report.
  it('counts a row no namespace can reach', () => {
    const index = parseSimbadValuesTsv(tsv(
      row({ oid: '1', rv: '5', bibcode: 'X', hip: '6' }),
      row({ oid: '2', rv: '6', bibcode: 'Y' }),
    ));
    expect(index.rowCount).toBe(2);
    expect(index.byHip.size).toBe(1);
  });

  // A collision means two SIMBAD objects claim one identifier: the cascade
  // would read a value off whichever won, so the file is rejected instead.
  it('throws when two rows collide in a namespace', () => {
    expect(() => parseSimbadValuesTsv(tsv(
      row({ oid: '1', hip: '7' }),
      row({ oid: '2', hip: '7' }),
    ))).toThrow(/two rows keyed hip=7/);
  });

  it('throws on a file missing a column rather than reading zero rows', () => {
    expect(() => parseSimbadValuesTsv('simbad_oid\thip\n1\t2\n'))
      .toThrow(/missing required columns/);
  });
});

describe('lookupSimbadValues', () => {
  const index = parseSimbadValuesTsv(tsv(
    row({ oid: '1', rv: '1', bibcode: 'A', sourceId: '99', hip: '11' }),
    row({ oid: '2', rv: '2', bibcode: 'B', hip: '22' }),
    row({ oid: '3', rv: '3', bibcode: 'C', tyc: '1-2-1' }),
    row({ oid: '4', rv: '4', bibcode: 'D', gj: '165 A' }),
  ));

  it('prefers source_id over every designation namespace', () => {
    expect(lookupSimbadValues(index, {
      sourceId: '99', hip: 22, tyc: '1-2-1', gl: 'GJ 165A',
    })?.rv?.bibcode).toBe('A');
  });

  it('falls through HIP, then GJ, then TYC', () => {
    expect(lookupSimbadValues(index, { ...NO_KEYS, sourceId: 'absent', hip: 22 })?.rv?.bibcode)
      .toBe('B');
    expect(lookupSimbadValues(index, { ...NO_KEYS, hip: 404, gl: 'Gl 165A' })?.rv?.bibcode)
      .toBe('D');
    expect(lookupSimbadValues(index, { ...NO_KEYS, gl: 'Gl absent', tyc: '1-2-1' })?.rv?.bibcode)
      .toBe('C');
  });

  it('takes the component-naming GJ over the system-naming TYC', () => {
    // The whole point of the order: a GJ carries its component letter and
    // names one star, where a TYC names the Tycho entry — the system on a
    // close pair. A record holding both must not take the blend.
    expect(lookupSimbadValues(index, {
      ...NO_KEYS, tyc: '1-2-1', gl: 'GJ 165A',
    })?.rv?.bibcode).toBe('D');
  });

  it('answers null for a record no namespace reaches', () => {
    expect(lookupSimbadValues(index, { ...NO_KEYS, sourceId: 'absent', hip: 404 })).toBeNull();
    expect(lookupSimbadValues(emptySimbadValueIndex(), { ...NO_KEYS, hip: 11 })).toBeNull();
  });
});
