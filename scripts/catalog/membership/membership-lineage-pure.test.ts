import { describe, expect, it } from 'vitest';

import type { IdentityRow } from '../lineage/identity/identity-pure';
import { componentsOfBindingLineage, identityLookup, multiplesComponentJoin } from './membership-lineage-pure';
import type { LineageRow } from '../lineage/lineage-row-pure';

const identity = (key: string, hip: string): IdentityRow =>
  ({ key, tyc: '', hip, hd: '', gl: '', gaia_source_id: '', designations: [] });

describe('identityLookup', () => {
  it('answers from the current build, reading the baseline only for a key the build lacks, once', () => {
    let reads = 0;
    const lookup = identityLookup([identity('spine:1', '10')], () => {
      reads++;
      return [identity('spine:1', '99'), identity('spine:2', '20')];
    });
    expect(lookup('spine:1')?.hip).toBe('10');
    expect(reads).toBe(0);
    expect(lookup('spine:2')?.hip).toBe('20');
    expect(lookup('spine:3')).toBeUndefined();
    expect(reads).toBe(1);
  });
});

describe('multiplesComponentJoin', () => {
  it('names the multiples components on the key\'s HIP, empty for a key with none', () => {
    const join = multiplesComponentJoin(
      identityLookup([identity('spine:1', '10'), identity('spine:2', '')], () => []),
      [{ systemId: '00057+4549', comp: 'A', hip: 10 }, { systemId: '00057+4549', comp: 'B', hip: 10 }],
    );
    expect(join.of('spine:1')).toBe('00057+4549/A|00057+4549/B');
    expect(join.of('spine:2')).toBe('');
    expect(join.of('spine:9')).toBe('');
  });
});

describe('componentsOfBindingLineage', () => {
  const row = (key: string, code: string, params: string): LineageRow =>
    ({ stage: 'component-binding', key, role: 'outcome', code, params, evidence: [] });

  it('reads each component binding a HIP, own or inherited, off its key and params', () => {
    expect(componentsOfBindingLineage([
      row('multiples:00057+4549-AB/A', 'component-binding.hip.own', '{"hip":"hip:10"}'),
      row('multiples:00057+4549-AB/B', 'component-binding.hip.inherited.partner', '{"from":"A","hip":"hip:10"}'),
      row('multiples:00057+4549-AB/B', 'component-binding.gaia.own', '{"gaia":"7"}'),
      row('multiples:00058+0000-AB/A', 'component-binding.hip.unbound', ''),
    ])).toEqual([
      { systemId: '00057+4549-AB', comp: 'A', hip: 10 },
      { systemId: '00057+4549-AB', comp: 'B', hip: 10 },
    ]);
  });
});
