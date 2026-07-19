import { describe, expect, it } from 'vitest';
import type { Target } from '../camera/focus/focus-target';
import {
  SystemMembershipRegistry,
  type SystemMember,
  type SystemMembershipProvider,
} from './system-membership';

const star = (idx: number, name: string | null = null): SystemMember => ({
  target: { kind: 'star', idx },
  name,
});
const planet = (idx: number, name: string | null = null): SystemMember => ({
  target: { kind: 'planet', idx },
  name,
});

function providerFor(
  covers: (t: Target) => boolean,
  members: SystemMember[],
  cluster: SystemMember[],
): SystemMembershipProvider {
  return {
    membersOf: (t) => (covers(t) ? members : []),
    collapsedClusterOf: (t) => (covers(t) ? cluster : []),
  };
}

describe('SystemMembershipRegistry', () => {
  it('returns [] with no providers and resolves the lead to the target itself', () => {
    const reg = new SystemMembershipRegistry();
    const t: Target = { kind: 'star', idx: 7 };
    expect(reg.membersOf(t)).toEqual([]);
    expect(reg.collapsedClusterOf(t)).toEqual([]);
    expect(reg.collapsedLeadOf(t)).toEqual(t);
  });

  it('unions members across providers, deduplicating on (kind, idx)', () => {
    const reg = new SystemMembershipRegistry();
    const isStar0 = (t: Target) => t.kind === 'star' && t.idx === 0;
    // Binary-shaped provider: star 0 with companion star 1.
    reg.register(providerFor(isStar0, [star(0), star(1)], []));
    // Planet-shaped provider: star 0 hosting two planets.
    reg.register(providerFor(isStar0, [star(0), planet(3, 'b'), planet(4, 'c')], []));
    expect(reg.membersOf({ kind: 'star', idx: 0 })).toEqual([
      star(0),
      star(1),
      planet(3, 'b'),
      planet(4, 'c'),
    ]);
  });

  it('same idx under different kinds does not deduplicate', () => {
    const reg = new SystemMembershipRegistry();
    reg.register(providerFor(() => true, [star(5), planet(5, 'x')], []));
    expect(reg.membersOf({ kind: 'star', idx: 5 })).toHaveLength(2);
  });

  it('the first registered provider covering the target supplies the cluster lead', () => {
    const reg = new SystemMembershipRegistry();
    const covers = (t: Target) => t.kind === 'star' && t.idx === 1;
    // Binary cluster: hovered star 1 is a suppressed secondary of 0.
    reg.register(providerFor(covers, [star(0), star(1)], [star(0), star(1)]));
    // Planet cluster: star 1 also hosts a collapsed planet.
    reg.register(providerFor(covers, [star(1), planet(9)], [star(1), planet(9)]));
    expect(reg.collapsedClusterOf({ kind: 'star', idx: 1 })).toEqual([
      star(0),
      star(1),
      planet(9),
    ]);
    expect(reg.collapsedLeadOf({ kind: 'star', idx: 1 })).toEqual({ kind: 'star', idx: 0 });
  });

  it('collapsedLeadOf falls back to the target when nothing is collapsed', () => {
    const reg = new SystemMembershipRegistry();
    reg.register(providerFor(() => true, [star(0), star(1), star(2)], []));
    expect(reg.collapsedLeadOf({ kind: 'star', idx: 2 })).toEqual({ kind: 'star', idx: 2 });
  });
});
