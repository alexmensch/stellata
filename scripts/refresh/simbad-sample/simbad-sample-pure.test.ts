import { describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { mulberry32 } from '../../util/seeded-random-pure';
import type { Row } from '../pull/columns-pure';
import { phaseTemplate, type Phase } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fakeAsk } from '../simbad/simbad-fake-pure';
import {
  ANCHORS, BINS, BIN_PHASES, SAMPLE_SIZE, SEED, binPhase, derived, drawBin, samplePull,
} from './simbad-sample-pure';

const candidate = (oid: number, v: string | null = '5.000'): Row =>
  [String(oid), `star ${oid}`, '1.0', '2.0', '10.0', '0.1', '0.0', '0.0', '*', 'G2V', v];
const oids = (rows: readonly Row[]) => rows.map((r) => Number(r[0]));

describe('binPhase', () => {
  it('asks the bin\'s V range among the star otypes, thinned server-side by MOD', () => {
    expect(phaseTemplate(binPhase(BINS[2]), SIMBAD.quote)).toBe(
      'SELECT b.oid AS oid, b.main_id AS main_id, b.ra AS ra, b.dec AS dec, b.plx_value AS plx_value, b.plx_err AS plx_err, '
      + 'b.pmra AS pmra, b.pmdec AS pmdec, b.otype AS otype, b.sp_type AS sp_type, f."V" AS v_mag '
      + 'FROM basic AS b JOIN allfluxes AS f ON f.oidref = b.oid '
      + `WHERE f."V" IS NOT NULL AND f."V" < 11.5 AND f."V" >= 9 AND b.otype IN (SELECT otype FROM otypedef WHERE path LIKE '*%') AND MOD(b.oid, 23) = ${SEED % 23}`,
    );
    expect(phaseTemplate(binPhase(BINS[0]), SIMBAD.quote)).not.toContain('MOD');
  });

  it('draws 50,000, the band\'s only row count', () => {
    expect(SAMPLE_SIZE).toBe(50_000);
  });
});

describe('drawBin', () => {
  const bin = { vMin: null, vMax: 6, target: 4, modK: 1, anchors: [7, 3] };
  const pool = [9, 3, 1, 7, 5, 8, 2, 6].map((oid) => candidate(oid));

  it('always draws the anchors, then the rest of the target from the others', () => {
    const drawn = oids(drawBin(pool, bin, mulberry32(1), 'bin'));
    expect(drawn).toHaveLength(4);
    expect(drawn.slice(0, 2)).toEqual([3, 7]);
    expect(new Set(drawn).size).toBe(4);
  });

  it('draws the same rows whatever order the candidates arrive in', () => {
    expect(oids(drawBin([...pool].reverse(), bin, mulberry32(1), 'bin'))).toEqual(oids(drawBin(pool, bin, mulberry32(1), 'bin')));
  });

  it('takes every candidate when there are exactly as many as the target', () => {
    expect(oids(drawBin(pool.slice(0, 4), { ...bin, anchors: [] }, mulberry32(1), 'bin')).sort()).toEqual([1, 3, 7, 9]);
  });

  it('refuses a bin short of its target, or missing an anchor', () => {
    expect(() => drawBin(pool.slice(0, 3), bin, mulberry32(1), 'bin1')).toThrow('bin1: 3 candidates for a target of 4');
    expect(() => drawBin(pool, { ...bin, anchors: [4] }, mulberry32(1), 'bin1')).toThrow(/anchor oid of 4/);
  });
});

describe('derived', () => {
  it('states distance and absolute V for a positive parallax', () => {
    const { distancePc, absmag } = derived('100.0', '5.0');
    expect([Number(distancePc), Number(absmag)]).toEqual([10, 5]);
  });

  it('states neither for a parallax at or below zero, or none', () => {
    for (const plx of ['-0.5', '0', null]) expect(derived(plx, '5.0')).toEqual({ distancePc: null, absmag: null });
  });
});

describe('samplePull', () => {
  const pull = samplePull(declareOutputs({ sample: 'unused.tsv' }));

  function fake(v: string | null) {
    let next = 100_000;
    const whole = new Map<Phase, Row[]>(BIN_PHASES.map((phase, i) => [phase, [
      ...BINS[i].anchors.map((oid) => candidate(oid, v)),
      ...Array.from({ length: BINS[i].target - BINS[i].anchors.length }, () => candidate(next++, v)),
    ]]));
    return fakeAsk({ idents: [{ oid: ANCHORS[0], id: 'HIP 111169' }, { oid: ANCHORS[0], id: 'Gaia DR3 1988193348344678656' }], basic: new Map(), wholeTables: whole });
  }

  it('declares every phase it asks, its parameters in the describe', () => {
    expect(Object.keys(pull.phases)).toEqual(['bin1', 'bin2', 'bin3', 'bin4', 'idents']);
    expect(pull.parameters).toEqual({ seed: SEED, targets: [5_000, 15_000, 20_000, 10_000], anchors: [ANCHORS, [], [], []] });
  });

  it('joins idents to the drawn rows and fails the Gaia floor it misses', async () => {
    const { ask } = fake('5.000');
    const { rows, checks } = await pull.run(ask, () => {});
    expect(rows.sample).toHaveLength(SAMPLE_SIZE);
    const alf = rows.sample.find((r) => r[0] === String(ANCHORS[0]));
    expect(alf?.slice(2, 4)).toEqual(['111169', '1988193348344678656']);
    expect(checks.map((c) => c.kind)).toEqual(['pass', 'fail']);
  });

  it('refuses a candidate with no V, naming its oid', async () => {
    const { ask } = fake(null);
    await expect(pull.run(ask, () => {})).rejects.toThrow(`SIMBAD oid ${ANCHORS[0]} passed the "V IS NOT NULL" filter with no v_mag`);
  });
});
