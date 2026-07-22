import { describe, expect, it } from 'vitest';
import { makeBinaries, makeRelation } from './binary-relation-fixture';
import { createBinarySystemMembership } from './binary-system-membership';

// Castor-like shape: 0=A, 1=Aa2 (inner of A), 2=B, 4=C — A anchors
// B and C; Aa2 is A's inner spectroscopic partner.
const BINARIES = makeBinaries([
  makeRelation({ primaryIdx: 0, secondaryIdx: 2 }),
  makeRelation({ primaryIdx: 0, secondaryIdx: 1 }),
  makeRelation({ primaryIdx: 0, secondaryIdx: 4 }),
]);

const provider = (collapsed: (i: number) => boolean, binaries = BINARIES) =>
  createBinarySystemMembership({
    getBinaries: () => binaries,
    isCollapsed: collapsed,
  });

describe('createBinarySystemMembership', () => {
  it('membersOf walks the whole connected system, primary first, names deferred', () => {
    const members = provider(() => false).membersOf({ kind: 'star', idx: 1 });
    expect(members.map((m) => m.target)).toEqual([
      { kind: 'star', idx: 0 },
      { kind: 'star', idx: 2 },
      { kind: 'star', idx: 1 },
      { kind: 'star', idx: 4 },
    ]);
    expect(members.every((m) => m.name === null)).toBe(true);
  });

  it('membersOf is [] for a star in no relation and for non-star targets', () => {
    const p = provider(() => true);
    expect(p.membersOf({ kind: 'star', idx: 9 })).toEqual([]);
    expect(p.membersOf({ kind: 'planet', idx: 0 })).toEqual([]);
    expect(p.collapsedClusterOf({ kind: 'planet', idx: 0 })).toEqual([]);
  });

  it('collapsedClusterOf returns the suppressed-edge component, lead first', () => {
    // Only Aa2 (idx 1) is composite-suppressed: cluster is A + Aa2.
    const cluster = provider((i) => i === 1).collapsedClusterOf({ kind: 'star', idx: 0 });
    expect(cluster.map((m) => m.target.idx)).toEqual([0, 1]);
  });

  it('collapsedClusterOf is [] when nothing is suppressed (singleton collapses to no cluster)', () => {
    const p = provider(() => false);
    expect(p.collapsedClusterOf({ kind: 'star', idx: 0 })).toEqual([]);
    // A star outside every relation also reports no cluster.
    expect(p.collapsedClusterOf({ kind: 'star', idx: 9 })).toEqual([]);
  });

  it('returns [] for everything when binaries.bin is absent', () => {
    const p = createBinarySystemMembership({ getBinaries: () => null, isCollapsed: () => true });
    expect(p.membersOf({ kind: 'star', idx: 0 })).toEqual([]);
    expect(p.collapsedClusterOf({ kind: 'star', idx: 0 })).toEqual([]);
  });
});
