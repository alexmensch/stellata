import { describe, expect, it } from 'vitest';
import { DAYS_PER_JULIAN_YEAR } from '../../../src/astro-core/astronomy-constants';

import { fold } from '../../util/counts/tally-pure';
import { wdsPair } from '../../wds/wds-fixture';
import type { NssOrbitRow } from '../load/gaia-pure';
import { nssOrbitalRow, nssRow } from '../orbits/nss-fixture';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed, ids, indices, type Side } from '../resolve/resolve-fixture';
import { inheritedFrom } from '../multiples-tsv';
import { NSS_SYNTHESIS_OUTCOMES, SYNTH_NSS_DISCOVERER, synthesizeNssInnerPairs } from './nss-inner-pairs-pure';
import type { ComponentAstrometry, PairAstrometry } from './routes-pure';

const AST: ComponentAstrometry = {
  astrometryVia: 'gaia_5p', raDeg: 100, decDeg: 0, parallaxMas: 50, parallaxErrorMas: 0.05, pmraMasyr: 1, pmdecMasyr: -1, refEpoch: 2016,
};

const side = (gaiaSourceId: string | null, over: Side = {}): Side =>
  ({ gaiaSourceId, resolveVia: gaiaSourceId === null ? 'unresolved' : 'simbad_xid', ...over });

const pairOf = (components: string, primary: Side, secondary: Side): DecomposedPair =>
  decomposed(wdsPair({ wdsId: 'W1', components }), { primary, secondary });

function run(pairs: readonly DecomposedPair[], nss: NssOrbitRow | readonly NssOrbitRow[], ast: ComponentAstrometry = AST) {
  const astrometry = new Map<DecomposedPair, PairAstrometry>(pairs.map((p) => [p, { primary: ast, secondary: ast }]));
  const rows = Array.isArray(nss) ? nss : [nss as NssOrbitRow];
  const r = synthesizeNssInnerPairs(pairs, astrometry, indices({ srcToNss: new Map(rows.map((n) => [n.sourceId, n])) }));
  return { ...r, tally: fold(NSS_SYNTHESIS_OUTCOMES, r.outcomes, (o) => o) };
}

const inRegime = nssOrbitalRow({ sourceId: '42', periodDays: 200 });
const abPair = (secondaryGaia = '99'): DecomposedPair => pairOf('AB', side('42', { hip: 7 }), side(secondaryGaia));

describe('synthesizeNssInnerPairs', () => {
  it('re-homes a carrier\'s orbit on a sub-resolution inner pair one level down, its identifiers and astrometry inherited', () => {
    const r = run([abPair()], inRegime);
    expect(r.pairs).toHaveLength(1);
    const inner = r.pairs[0];
    expect(inner.pair).toMatchObject({ wdsId: 'W1', components: 'Aa,Ab', discoverer: SYNTH_NSS_DISCOVERER, rhoLast: 0, precise: { raDeg: 100, decDeg: 0 } });
    expect(inner.tokens).toEqual(['Aa', 'Ab']);
    for (const c of [inner.primary, inner.secondary]) {
      expect(ids(c)).toMatchObject({ gaiaSourceId: '42', resolveVia: 'simbad_xid', hip: 7, discoverer: SYNTH_NSS_DISCOVERER });
      expect([c.gaia?.origin, c.hip?.origin]).toEqual([inheritedFrom('A', 'parent'), inheritedFrom('A', 'parent')]);
    }
    expect([inner.primary.isPrimary, inner.secondary.isPrimary]).toEqual([true, false]);
    expect(r.astrometry.get(inner)).toEqual({ primary: AST, secondary: AST });
    expect(r.astrometry.get(inner)!.primary).toBe(AST);
  });

  it('synthesizes nothing where the partner shares the blended source', () => {
    expect(run([abPair('42')], inRegime).pairs).toEqual([]);
  });

  it('takes the deepest token carrying the source', () => {
    const r = run([pairOf('AB', side('42'), side('99')), pairOf('Aa,Ab', side('42'), side('77'))], inRegime);
    expect(r.pairs.map((p) => p.pair.components)).toEqual(['Aa1,Aa2']);
  });

  it('skips a system that already names the children', () => {
    const r = run([pairOf('AB', side('42'), side('99')), pairOf('Aa,Ab', side('42'), side('42'))], inRegime);
    expect(r.pairs).toEqual([]);
    expect(r.tally.skipped_children_exist).toBe(1);
  });

  it('counts a pair synthesized for one carrier as existing for the next, in numeric source order', () => {
    const r = run(
      [pairOf('AC', side('100'), side('98')), pairOf('AB', side('42'), side('99'))],
      [nssOrbitalRow({ sourceId: '100', periodDays: 200 }), inRegime],
    );
    expect(r.pairs.map((p) => [p.pair.components, p.primary.gaia?.value])).toEqual([['Aa,Ab', '42']]);
    expect(r.tally.skipped_children_exist).toBe(1);
  });

  it('skips an orbit outside Gaia\'s detectability regime', () => {
    const r = run([abPair()], nssOrbitalRow({ sourceId: '42', periodDays: 10 * DAYS_PER_JULIAN_YEAR, aMas: 5000 }));
    expect(r.pairs).toEqual([]);
    expect(r.tally.skipped_out_of_regime).toBe(1);
  });

  it('skips elements that can never animate, but accepts a circular fit stating no ω', () => {
    const noE = run([abPair()], nssRow({ sourceId: '42', solutionType: 'SB1', period: 12.5, tPeriastron: 100 }));
    expect(noE.pairs).toEqual([]);
    expect(noE.tally.skipped_incomplete_elements).toBe(1);
    const circular = run([abPair()], nssRow({
      sourceId: '42', solutionType: 'EclipsingBinary', period: 0.81, tPeriastron: 100, eccentricity: 0, inclination: 86.5,
    }));
    expect(circular.pairs).toHaveLength(1);
  });

  it('skips elements missing P or T, or ω on a non-circular fit', () => {
    const sb1 = (over: Partial<NssOrbitRow>): NssOrbitRow =>
      nssRow({ sourceId: '42', solutionType: 'SB1', period: 12.5, tPeriastron: 100, eccentricity: 0.3, argPeriastron: 10, ...over });
    expect(run([abPair()], sb1({})).pairs).toHaveLength(1);
    for (const row of [
      { ...inRegime, period: null },
      sb1({ tPeriastron: null }),
      sb1({ solutionType: 'SB1C', argPeriastron: null }),
    ]) {
      expect([row, run([abPair()], row).tally.skipped_incomplete_elements]).toEqual([row, 1]);
    }
  });

  it('skips a compound carrier token, which has no deeper WDS convention', () => {
    const r = run([pairOf('AB,C', side('42'), side('99'))], inRegime);
    expect(r.pairs).toEqual([]);
    expect(r.tally.skipped_token_shape).toBe(1);
  });

  it('leaves the inner pair without a coordinate when the carrier has no astrometry', () => {
    expect(run([abPair()], inRegime, { astrometryVia: 'unresolved' }).pairs[0].pair.precise).toBeNull();
  });
});
