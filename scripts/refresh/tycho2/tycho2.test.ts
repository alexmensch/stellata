import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';
import type { Row } from '../pull/columns-pure';
import { describePhasedPull, phaseQueries, type Ask, type Phase } from '../pull/pull';
import { recordedTableCases, type RecordedFits } from '../pull/recorded-reply';
import { VIZIER } from '../pull/tap-pure';
import {
  MAIN, SUPPL1, TYC1_MAX, TYC1_MIN, bandPhase, keptBand, membershipCover, pairCarriedAsOneStar, parseTyc, requestLines,
  tyc1Bands, tycho2Pull, tycho2Request, unscannable, type Tycho2Request,
} from './tycho2-pure';

const OUTPUTS = declareOutputs({ main: 'tycho2_main.tsv', suppl1: 'tycho2_suppl1.tsv' });
const WRITTEN = tycho2Pull(OUTPUTS, { request: tycho2Request([], []), requestFrom: [] }).tables;

/** Recorded from the CfA mirror, the spot row's entry each (README.md#replies). */
function recorded(name: string, phase: Phase): RecordedFits {
  if (phase.scope.kind !== 'whole-table' || phase.scope.asu === undefined) throw new Error(`${name} has no ASU form`);
  return { fits: join(REPO_ROOT, `scripts/refresh/tycho2/${name}.cfa.fits`), asu: phase.scope.asu };
}

describe('main', () => recordedTableCases('main', DATA_FILES.tycho2Main, WRITTEN.main, recorded('main', bandPhase(MAIN, [3601, 4000]))));
describe('suppl1', () => recordedTableCases('suppl1', DATA_FILES.tycho2Suppl1, WRITTEN.suppl1, recorded('suppl1', bandPhase(SUPPL1, [1, 400]))));

describe('parseTyc', () => {
  it('reads a well-formed designation, surrounding space allowed', () => {
    expect(parseTyc('3694-2544-1')).toEqual([3694, 2544, 1]);
    expect(parseTyc('  55-256-1 ')).toEqual([55, 256, 1]);
  });

  it.each(['', '   ', '3694-2544', '3694-2544-1-2', 'TYC 1-2-1', '3694--1', 'a-b-c', '3694-2544-x'])('refuses "%s"', (bad) => {
    expect(parseTyc(bad)).toBeNull();
  });
});

describe('the request set', () => {
  it('unions the manifest\'s TYCs with IV/25\'s, one key per entry however it is spelled', () => {
    const request = tycho2Request(['1-2-1', '3-4-1', null, '  ', '0003-0004-1'], [[3, 4, 1], [5, 6, 1]]);
    expect([...request.membership].sort()).toEqual(['1-2-1', '3-4-1']);
    expect(requestLines(request)).toEqual(['1-2-1', '3-4-1', '5-6-1']);
  });
});

describe('the TYC1 bands', () => {
  it('cover every region exactly once, the last clamped to the ceiling', () => {
    const seen = tyc1Bands().flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    expect(seen).toEqual(Array.from({ length: TYC1_MAX - TYC1_MIN + 1 }, (_, i) => TYC1_MIN + i));
    expect(tyc1Bands(1000).at(-1)?.[1]).toBe(TYC1_MAX);
  });

  it('ask one quoted range query per band and table, and the same range of CfA\'s ASU', () => {
    const phase = bandPhase(MAIN, [401, 800]);
    const [query] = phaseQueries(phase, undefined, VIZIER.quote);
    expect(query).toContain('FROM "I/259/tyc2" WHERE "TYC1" BETWEEN 401 AND 800');
    expect(query).toContain('"RA(ICRS)" AS ra_icrs');
    const asu = phase.scope.kind === 'whole-table' ? phase.scope.asu : undefined;
    expect(asu?.source).toBe('I/259/tyc2');
    expect(asu?.constraints).toEqual({ TYC1: '401..800' });
    expect(asu?.columns.find((c) => c.name === 'ra_icrs')?.archive).toBe('RA(ICRS)');
    expect(tyc1Bands()).toHaveLength(24);
  });

  it('name a mentioned TYC no band scans', () => {
    expect(unscannable(['1-2-1', `${TYC1_MAX}-5-1`])).toEqual([]);
    expect(unscannable([`${TYC1_MAX + 1}-5-1`])).toEqual([`${TYC1_MAX + 1}-5-1`]);
  });
});

describe('the kept band', () => {
  it('floors both ends of the share', () => {
    expect(keptBand({ min: 0.98, max: 1 }, 372_618)).toEqual({ min: 365_165, max: 372_618 });
    expect(keptBand({ min: 0.004, max: 0.012 }, 372_618)).toEqual({ min: 1_490, max: 4_471 });
  });
});

describe('the cover gate', () => {
  const reached = (...keys: string[]) => new Set(keys);

  it('passes a full cover', () => {
    expect(membershipCover(new Set(['1-2-1']), reached('1-2-1', '5-5-1')).kind).toBe('pass');
  });

  it('fails an unreached primary as a membership event', () => {
    const check = membershipCover(new Set(['1-2-1', '3-4-1']), reached('1-2-1'));
    expect(check.kind).toBe('fail');
    expect(check.kind === 'fail' && check.message).toMatch(/3-4-1.*membership event/);
  });

  it('admits a component whose pair entry Tycho-2 carries as one star, never a primary by its own entry', () => {
    expect(membershipCover(new Set(['1-2-1', '1-2-2']), reached('1-2-1')).kind).toBe('pass');
    expect(membershipCover(new Set(['3-4-2']), reached('1-2-1')).kind).toBe('fail');
    expect(pairCarriedAsOneStar('1-2-1', reached('1-2-1'))).toBe(false);
  });
});

const rowOf = (tyc1: number, tyc2: number, tyc3: number): Row => [String(tyc1), String(tyc2), String(tyc3)];

function runWith(request: Tycho2Request, mainRows: readonly Row[]) {
  const pull = tycho2Pull(OUTPUTS, { request, requestFrom: ['manifest.tsv', 'tyc2_hd.tsv'] });
  const ask: Ask = async (phase) => {
    if (!phase.from.includes('tyc2')) return [];
    const where = /BETWEEN (\d+) AND (\d+)/.exec(phase.where ?? '');
    const [lo, hi] = [Number(where?.[1]), Number(where?.[2])];
    return mainRows.filter((row) => Number(row[0]) >= lo && Number(row[0]) <= hi);
  };
  return pull.run(ask, () => {});
}

describe('the run', () => {
  const request = tycho2Request(['1-2-1', '9000-3-1'], [[4, 5, 1]]);

  it('keeps only rows whose full TYC was requested, across bands', async () => {
    const { rows, checks } = await runWith(request, [rowOf(1, 2, 1), rowOf(1, 2, 2), rowOf(4, 5, 1), rowOf(9000, 3, 1), rowOf(9000, 4, 1)]);
    expect(rows.main.map((row) => row.slice(0, 3).join('-')).sort()).toEqual(['1-2-1', '4-5-1', '9000-3-1']);
    expect(checks.map((c) => c.kind)).toEqual(['pass']);
  });

  it('refuses an empty request and a TYC1 outside the span before asking anything', async () => {
    await expect(runWith(tycho2Request([], []), [])).rejects.toThrow(/name no TYC/);
    await expect(runWith(tycho2Request([`${TYC1_MAX + 1}-5-1`], []), [])).rejects.toThrow(/outside the scanned TYC1 span/);
  });

  it('describes its 48 band queries and the mentioned TYCs as its request', () => {
    const described = describePhasedPull(tycho2Pull(OUTPUTS, { request, requestFrom: ['m', 't'] }));
    expect(Object.keys(JSON.parse(described.query).phases)).toHaveLength(48);
    expect(described.request).toEqual(['1-2-1', '4-5-1', '9000-3-1']);
    expect(described.services).toEqual(['CDS', 'CfA']);
  });
});
