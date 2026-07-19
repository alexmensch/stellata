import { describe, expect, it } from 'vitest';
import { NO_PARENT, type BinariesData } from './binaries-loader';
import { makeRelation } from './binary-relation-fixture';
import { focalChainRelationSet } from './focal-chain';

// Hierarchy: outer pair 0↔2 (relation 0), inner pair 0↔1 (relation 1,
// child of 0). Star 3 is an unrelated control.
const HIERARCHY: BinariesData = {
  version: 1,
  relations: [
    makeRelation({ primaryIdx: 0, secondaryIdx: 2, parentRelation: NO_PARENT }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 1, parentRelation: 0 }),
  ],
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
