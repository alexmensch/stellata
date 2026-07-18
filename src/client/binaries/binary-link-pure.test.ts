import { describe, expect, it } from 'vitest';
import {
  NO_PARENT,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';
import { focalChainRelationSet } from './focal-chain';
import { binaryLinkPairs } from './binary-link-pure';

function rel(primaryIdx: number, secondaryIdx: number, parentRelation: number): BinaryRelation {
  return {
    primaryIdx,
    secondaryIdx,
    flags: 0,
    parentRelation,
    pDays: 1,
    tJd: 0,
    e: 0,
    aAU: 1,
    iRad: 0,
    omegaRad: 0,
    OmegaRad: 0,
    q: 0.5,
    sepArcsec: 1,
    paDeg: 0,
    sepPaEpochJd: 0,
  };
}

// Hierarchy: outer pair 0↔2 (relation 0), inner pair 0↔1 (relation 1, child
// of 0). Star 3 is an unrelated control.
const HIERARCHY: BinariesData = {
  version: 1,
  relations: [rel(0, 2, NO_PARENT), rel(0, 1, 0)],
  primaryIdxToRelations: new Map([[0, [0, 1]]]),
  secondaryIdxToRelations: new Map([[1, [1]], [2, [0]]]),
};

describe('focalChainRelationSet', () => {
  it('is empty for a null focal or no membership', () => {
    expect(focalChainRelationSet(HIERARCHY, null).size).toBe(0);
    expect(focalChainRelationSet(HIERARCHY, 3).size).toBe(0);
  });

  it('collects every relation writing the focal slot', () => {
    expect(focalChainRelationSet(HIERARCHY, 0)).toEqual(new Set([0, 1]));
  });

  it('walks parentRelation ancestors from a focused inner secondary', () => {
    // Star 1 is the inner secondary (relation 1); its parent is relation 0.
    expect(focalChainRelationSet(HIERARCHY, 1)).toEqual(new Set([1, 0]));
  });

  it('a focused outer secondary pulls only its own relation', () => {
    expect(focalChainRelationSet(HIERARCHY, 2)).toEqual(new Set([0]));
  });
});

const sortedKeys = (pairs: Array<[number, number]>): string[] =>
  pairs.map(([a, b]) => `${a}-${b}`).sort();

describe('binaryLinkPairs', () => {
  it('returns no pairs without binaries data or star focus', () => {
    expect(binaryLinkPairs(null, 0)).toEqual([]);
    expect(binaryLinkPairs(HIERARCHY, null)).toEqual([]);
    expect(binaryLinkPairs(HIERARCHY, 3)).toEqual([]);
  });

  it('maps each chain relation to its primary↔secondary slot pair', () => {
    expect(sortedKeys(binaryLinkPairs(HIERARCHY, 0))).toEqual(['0-1', '0-2']);
  });

  it('includes the parent pair when a focused inner member has one', () => {
    expect(sortedKeys(binaryLinkPairs(HIERARCHY, 1))).toEqual(['0-1', '0-2']);
  });
});
