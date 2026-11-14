import { describe, expect, it } from 'vitest';

import { componentKey } from '../component-tokens-pure';
import { wdsPair } from '../../wds/wds-fixture';
import { readTable } from '../../util/tsv/table-pure';
import { own, unresolvedComponent, type DecomposedPair, type ResolvedComponent } from './components-pure';
import { SPOT_CHECK_COLUMNS, spotCheckProblems, strongestComponents, truthRow } from './spot-check-pure';

const SPEC = { file: 'fixture/spot_check.tsv', hint: 'h', columns: SPOT_CHECK_COLUMNS };
const truth = (cells: string) => [...readTable(SPEC, `${SPOT_CHECK_COLUMNS.join('\t')}\n${cells}\n`)].map(truthRow)[0];

function decomposed(primary: ResolvedComponent, secondary: ResolvedComponent): DecomposedPair {
  return { pair: wdsPair({ wdsId: primary.wdsId }), tokens: [primary.component, secondary.component], primary, secondary };
}

const pair = wdsPair({ wdsId: '00001+0001' });
const a = unresolvedComponent(pair, 'A', true);
const b = unresolvedComponent(pair, 'B', false);

describe('spot-check', () => {
  it('keeps the strongest-tier instance of a letter several rows resolve', () => {
    const viaSimbad = { ...a, gaia: own('7'), resolveVia: 'simbad_xid' as const };
    const viaOrb6 = { ...a, gaia: own('7'), resolveVia: 'orb6_hip' as const };
    const best = strongestComponents([decomposed(viaSimbad, b), decomposed(viaOrb6, b)]);
    expect(best.get(componentKey('00001+0001', 'A'))?.resolveVia).toBe('orb6_hip');
  });

  it('reports a tier drift and a source drift apart', () => {
    const row = truth('c\tn\t00001+0001\tA\torb6_hip\t7\t');
    const best = strongestComponents([decomposed({ ...a, gaia: own('8'), resolveVia: 'ccdm_hip' }, b)]);
    expect(spotCheckProblems(row, best)).toEqual([
      'resolve_via: expected orb6_hip, got ccdm_hip',
      'gaia_source_id: expected 7, got 8',
    ]);
  });

  it('passes a matching row and an unresolved one with no source', () => {
    const best = strongestComponents([decomposed({ ...a, gaia: own('7'), resolveVia: 'orb6_hip' }, b)]);
    expect(spotCheckProblems(truth('c\tn\t00001+0001\tA\torb6_hip\t7\t'), best)).toEqual([]);
    expect(spotCheckProblems(truth('c\tn\t00001+0001\tB\tunresolved\t\t'), best)).toEqual([]);
  });

  it('holds an absent row to no component at all', () => {
    const best = strongestComponents([decomposed(a, b)]);
    expect(spotCheckProblems(truth('c\tn\t00001+0001\tC\tabsent\t\t'), best)).toEqual([]);
    expect(spotCheckProblems(truth('c\tn\t00001+0001\tA\tabsent\t\t'), best))
      .toEqual(['expected NO component, got (null, unresolved)']);
  });

  it('reports a key Stage 2 never emitted', () => {
    expect(spotCheckProblems(truth('c\tn\t00001+0001\tD\tsimbad_xid\t9\t'), strongestComponents([])))
      .toEqual(['expected (9, simbad_xid), got no component at all']);
  });

  it('refuses an expected tier outside RESOLVE_VIA', () => {
    expect(() => truth('c\tn\t00001+0001\tA\tposition\t\t')).toThrow(/is not one of/);
  });
});
