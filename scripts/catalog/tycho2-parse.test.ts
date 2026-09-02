import { describe, it, expect } from 'vitest';

import {
  TYCHO2_ICRS_EPOCH, TYCHO2_MEAN_EPOCH, parseTycho2Tsvs, tycho2Key,
} from './tycho2-parse';

const MAIN_HEADER = [
  'tyc1', 'tyc2', 'tyc3', 'pflag', 'ra_mdeg', 'de_mdeg', 'ep_ra', 'ep_de',
  'pm_ra', 'pm_de', 'e_pm_ra', 'e_pm_de', 'ra_icrs', 'de_icrs',
  'bt_mag', 'e_bt_mag', 'vt_mag', 'e_vt_mag', 'prox', 'hip',
].join('\t');

const SUPPL_HEADER = [
  'tyc1', 'tyc2', 'tyc3', 'flag', 'ra_icrs', 'de_icrs', 'pm_ra', 'pm_de',
  'e_pm_ra', 'e_pm_de', 'bt_mag', 'e_bt_mag', 'vt_mag', 'e_vt_mag',
  'prox', 'hip',
].join('\t');

interface MainCells {
  tyc?: [string, string, string];
  pflag?: string;
  mean?: [string, string, string, string];   // ra, de, ep_ra, ep_de
  pm?: [string, string];
  icrs?: [string, string];
  photometry?: [string, string];             // bt, vt
}

function mainRow(c: MainCells = {}): string {
  const [t1, t2, t3] = c.tyc ?? ['1', '1', '1'];
  const [ra, de, epRa, epDe] = c.mean ?? ['33.5', '12.25', '1991.07', '1991.00'];
  const [pmRa, pmDe] = c.pm ?? ['10', '-10'];
  const [raI, deI] = c.icrs ?? ['33.6', '12.3'];
  const [bt, vt] = c.photometry ?? ['9.5', '8.9'];
  return [t1, t2, t3, c.pflag ?? '', ra, de, epRa, epDe,
    pmRa, pmDe, '1', '1', raI, deI, bt, '0.01', vt, '0.01', '', ''].join('\t');
}

function supplRow(tyc: [string, string, string], flag = 'H', pm = ['5', '-5']): string {
  return [...tyc, flag, '40.0', '20.0', pm[0], pm[1], '1', '1',
    '10.5', '0.01', '10.0', '0.01', '', ''].join('\t');
}

const main = (...rows: string[]) => [MAIN_HEADER, ...rows].join('\n');
const suppl = (...rows: string[]) => [SUPPL_HEADER, ...rows].join('\n');

describe('parseTycho2Tsvs', () => {
  // ep_ra / ep_de sit in the fixture at 1991.07 / 1991.00 precisely so this
  // asserts they are NOT read as the position's epoch: they date the
  // observations, and the mean position they produced is stated at J2000.
  it('states the mean position at J2000, not at the observation epochs', () => {
    const index = parseTycho2Tsvs(main(mainRow()), suppl());
    const r = index.get('1-1-1')!;
    expect(r.raDeg).toBe(33.5);
    expect(r.decDeg).toBe(12.25);
    expect(r.epoch).toBe(TYCHO2_MEAN_EPOCH);
    expect(r.epoch).toBe(2000.0);
    expect(r.fromIcrs).toBe(false);
    expect(r.pmRaMasyr).toBe(10);
    expect(r.btMag).toBe(9.5);
    expect(r.vtMag).toBe(8.9);
  });

  // pflag='X' rows carry no mean solution at all — ra_mdeg, ep_ra, pm_ra and
  // their Dec siblings are empty, and the observed cell is the only position
  // the row has. It is stated at J1991.25, not J2000.
  it('falls a mean-solution-less row back to its observed cell at J1991.25', () => {
    const index = parseTycho2Tsvs(
      main(mainRow({ pflag: 'X', mean: ['', '', '', ''], pm: ['', ''] })),
      suppl(),
    );
    const r = index.get('1-1-1')!;
    expect(r.raDeg).toBe(33.6);
    expect(r.decDeg).toBe(12.3);
    expect(r.epoch).toBe(TYCHO2_ICRS_EPOCH);
    expect(r.epoch).toBe(1991.25);
    expect(r.fromIcrs).toBe(true);
    expect(r.pmRaMasyr).toBeNull();
    expect(r.isPhotocentre).toBe(false);
  });

  // A row is taken to have a mean solution on its position cells alone. The
  // epoch columns no longer gate that, because nothing reads their values.
  it('prefers the mean position without consulting the epoch columns', () => {
    const index = parseTycho2Tsvs(
      main(mainRow({ mean: ['33.5', '12.25', '', ''] })),
      suppl(),
    );
    const r = index.get('1-1-1')!;
    expect(r.fromIcrs).toBe(false);
    expect(r.raDeg).toBe(33.5);
    expect(r.epoch).toBe(TYCHO2_MEAN_EPOCH);
  });

  it('reads the supplement only where the main table has no row', () => {
    const index = parseTycho2Tsvs(
      main(mainRow({ tyc: ['1', '1', '1'] })),
      suppl(supplRow(['1', '1', '1']), supplRow(['2', '2', '1'])),
    );
    // The main row wins the shared identifier: it has a mean solution and a PM
    // where 1,404 supplement rows carry no PM at all.
    expect(index.get('1-1-1')!.fromIcrs).toBe(false);
    expect(index.get('1-1-1')!.raDeg).toBe(33.5);
    // The supplement-only identifier still lands.
    const s = index.get('2-2-1')!;
    expect(s.raDeg).toBe(40.0);
    expect(s.epoch).toBe(TYCHO2_ICRS_EPOCH);
    expect(s.fromIcrs).toBe(true);
    expect(s.pmRaMasyr).toBe(5);
  });

  it("keeps a supplement row's absent PM null", () => {
    const index = parseTycho2Tsvs(
      main(), suppl(supplRow(['3', '3', '1'], 'T', ['', ''])),
    );
    const r = index.get('3-3-1')!;
    expect(r.pmRaMasyr).toBeNull();
    expect(r.pmDecMasyr).toBeNull();
    expect(r.isPhotocentre).toBe(false);
  });

  // pflag='P' means the mean solution is the light-centre of a double
  // Tycho-2 never split, so both cascades reading the row need to know.
  it("marks a pflag='P' mean solution as a photocentre", () => {
    const index = parseTycho2Tsvs(main(mainRow({ pflag: 'P' })), suppl());
    const r = index.get('1-1-1')!;
    expect(r.isPhotocentre).toBe(true);
    expect(r.fromIcrs).toBe(false);
  });

  it('drops a row carrying no position at all', () => {
    const index = parseTycho2Tsvs(
      main(mainRow({ mean: ['', '', '', ''], icrs: ['', ''] })), suppl(),
    );
    expect(index.size).toBe(0);
  });

  it('composes the unpadded key the spine tyc column carries', () => {
    expect(tycho2Key('3694', '2544', '1')).toBe('3694-2544-1');
    expect(tycho2Key(' 3694 ', '2544', '1')).toBe('3694-2544-1');
  });
});
