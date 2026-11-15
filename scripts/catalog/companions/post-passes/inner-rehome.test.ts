import { describe, expect, it } from 'vitest';
import { makeStar } from '../../parse/star-fixture';
import { MintedIds } from '../identity/row-identity';
import { multiplesRow } from '../multiples-fixture';
import { ComponentSlots, reHomeInnerPairs } from './inner-rehome';

describe('ComponentSlots', () => {
  it('keeps a primary\'s first claim but lets a secondary overwrite it', () => {
    const slots = new ComponentSlots();
    slots.claimByPrimary('root', 'B', 1);
    slots.claimByPrimary('root', 'B', 2);
    expect(slots.get('root', 'B')).toBe(1);
    slots.claimBySecondary('root', 'B', 3);
    expect(slots.get('root', 'B')).toBe(3);
    slots.claimBySecondary(null, 'C', 4);
    expect(slots.get(null, 'C')).toBeUndefined();
  });
});

describe('reHomeInnerPairs', () => {
  it('collocates a sub-resolution inner secondary on its parent component, with its velocity', () => {
    const castorA = makeStar({ x: 15, vx: 1 });
    const castorB = makeStar({ x: 15.001, vx: 2 });
    const bb = makeStar({ x: 15, vx: 1 });
    const stars = [castorA, castorB, bb];
    const primary = multiplesRow({ systemId: '07346+3153-BaBb', comp: 'Ba', orbitRole: 'primary' });
    const secondary = multiplesRow({
      systemId: '07346+3153-BaBb', comp: 'Bb', sepArcsec: 0, pDays: 2.9, tJd: 2440000, e: 0, aAU: 0.03, iRad: 1, omegaRad: 0, OmegaRad: 0, q: 0.9,
    });
    const slots = new ComponentSlots();
    slots.claimByPrimary('07346+3153', 'B', 1);
    slots.claimBySecondary('07346+3153', 'Bb', 2);
    const moved = reHomeInnerPairs([{ primary, secondaries: [secondary] }], slots, new MintedIds(), (i) => stars[i]);
    expect(moved).toEqual([bb]);
    expect([bb.x, bb.vx]).toEqual([castorB.x, castorB.vx]);
  });
});
