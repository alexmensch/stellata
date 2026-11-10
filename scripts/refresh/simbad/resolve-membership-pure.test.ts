import { describe, expect, it } from 'vitest';

import type { MembershipKeys, Designations } from './membership-keys-pure';
import { coverage, resolveMembershipKeys, wideningLabel } from './resolve-membership-pure';
import { fakeAsk } from './simbad-fake-pure';
import { parseLedger, simbadPhases } from './simbad-fetch-pure';
import { GAIA_DR3, GJ, HIP, OID, TYC } from './simbad-specs-pure';
import { simbad } from './simbad-test-fixtures';

const PHASES = simbadPhases({ basic: [OID], idents: [HIP] });
const HIP_WIDENING = wideningLabel(HIP);
const TYC_WIDENING = wideningLabel(TYC);
const GJ_WIDENING = wideningLabel(GJ);

function keys(sourceIds: string[], designations: Record<string, Designations> = {}, hip: string[] = []): MembershipKeys {
  return { sourceIds, byNamespace: { hip, tyc: [], gj: [] }, designations: new Map(Object.entries(designations)), keyless: 0 };
}

async function resolve(k: MembershipKeys, ids: Record<number, readonly string[]>) {
  const fake = fakeAsk(simbad(ids));
  return { request: await resolveMembershipKeys(fake.ask, PHASES, k, parseLedger()), asked: fake.asked };
}

describe('resolveMembershipKeys', () => {
  it('widens only the source_ids the Gaia namespace missed', async () => {
    const { request } = await resolve(
      keys(['1', '2'], { 1: { tyc: '1-2-1' }, 2: { tyc: '5-6-1' } }),
      { 100: ['Gaia DR3 1'], 300: ['TYC 5-6-1'] },
    );
    expect(request.oids).toEqual(new Set([100, 300]));
    expect(request.requested.get(TYC_WIDENING)).toBe(1);
    expect(request.gainedByWidening.get(TYC_WIDENING)).toBe(1);
  });

  it('vetoes a widened binding SIMBAD names another DR3 source for', async () => {
    const { request } = await resolve(
      keys(['1', '2'], { 1: { tyc: '1-2-1' }, 2: { tyc: '5-6-1' } }),
      { 100: ['Gaia DR3 1'], 300: ['TYC 5-6-1', 'Gaia DR3 999'] },
    );
    expect(request.oids).toEqual(new Set([100]));
    expect(request.verdicts.get(TYC_WIDENING)).toEqual({ corroborated: 0, vetoed: 1, uncorroborated: 0 });
    expect(request.resolved.get(TYC_WIDENING)).toBe(0);
    expect(request.gainedByWidening.get(TYC_WIDENING)).toBe(0);
  });

  it('corroborates on the asking id held under an earlier release', async () => {
    const { request } = await resolve(keys(['2'], { 2: { gj: '4192' } }), { 300: ['GJ 4192', 'Gaia DR2 2', 'Gaia DR3 999'] });
    expect(request.oids).toEqual(new Set([300]));
    expect(request.verdicts.get(GJ_WIDENING)).toEqual({ corroborated: 1, vetoed: 0, uncorroborated: 0 });
  });

  it('keeps, uncorroborated, a binding with no DR3 id to contradict it', async () => {
    for (const held of [['HIP 4'], ['Gaia DR2 777']]) {
      const { request } = await resolve(keys(['2'], { 2: { tyc: '5-6-1' } }), { 300: ['TYC 5-6-1', ...held] });
      expect(request.oids).toEqual(new Set([300]));
      expect(request.verdicts.get(TYC_WIDENING)).toEqual({ corroborated: 0, vetoed: 0, uncorroborated: 1 });
    }
  });

  it('stops asking once a rung binds the row', async () => {
    const { request } = await resolve(keys(['2'], { 2: { hip: '7', tyc: '5-6-1' } }), { 300: ['HIP 7', 'Gaia DR2 2'] });
    expect(request.oids).toEqual(new Set([300]));
    expect(request.requested.get(HIP_WIDENING)).toBe(1);
    expect(request.requested.has(TYC_WIDENING)).toBe(false);
  });

  it('leaves a row a rung vetoed for the next rung', async () => {
    const { request } = await resolve(
      keys(['2'], { 2: { hip: '7', tyc: '5-6-1' } }),
      { 300: ['HIP 7', 'Gaia DR3 999'], 400: ['TYC 5-6-1', 'Gaia DR2 2'] },
    );
    expect(request.oids).toEqual(new Set([400]));
    expect(request.verdicts.get(HIP_WIDENING)?.vetoed).toBe(1);
    expect(request.verdicts.get(TYC_WIDENING)?.corroborated).toBe(1);
  });

  it('never widens on a designation two source_ids claim', async () => {
    const { request } = await resolve(keys(['1', '2'], { 1: { tyc: '5-6-1' }, 2: { tyc: '5-6-1' } }), { 300: ['TYC 5-6-1'] });
    expect(request.oids).toEqual(new Set());
    expect(request.requested.has(TYC_WIDENING)).toBe(false);
  });

  it('folds each binding into its namespace, a widening rung included', async () => {
    const { request } = await resolve(
      keys(['1', '2'], { 2: { hip: '8' } }, ['7']),
      { 100: ['Gaia DR3 1'], 200: ['HIP 7'], 300: ['HIP 8'] },
    );
    expect(request.oids).toEqual(new Set([100, 200, 300]));
    expect(request.bindings.get(GAIA_DR3.name)).toEqual(new Map([['1', 100]]));
    expect(request.bindings.get(HIP.name)).toEqual(new Map([['7', 200], ['8', 300]]));
    expect(coverage(request, GAIA_DR3.name)).toBe(0.5);
    expect(coverage(request, HIP.name)).toBe(1);
  });
});
