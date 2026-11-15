import { describe, expect, it } from 'vitest';
import { makeStar } from '../../parse/star-fixture';
import { SystemicGroups } from './systemic-velocity';

describe('SystemicGroups', () => {
  it('gives a lone pair its q-weighted barycentric velocity', () => {
    const stars = [makeStar({ vx: 10 }), makeStar({ vx: 20 })];
    const groups = new SystemicGroups();
    groups.add('root', 0, 0, 1, 0.25);
    groups.reconcile((i) => stars[i]);
    expect(stars.map((s) => s.vx)).toEqual([12.5, 12.5]);
  });

  it('gives every member of a multi-pair root its anchor\'s velocity', () => {
    const stars = [makeStar({ vx: 1 }), makeStar({ vx: 2 }), makeStar({ vx: 3 }), makeStar({ vx: 4 })];
    const groups = new SystemicGroups();
    groups.add('root', null, 1, 2, 0.5);
    groups.add('root', 0, 1, 3, 0.5);
    groups.reconcile((i) => stars[i]);
    expect(stars.map((s) => s.vx)).toEqual([1, 1, 1, 1]);
  });
});
