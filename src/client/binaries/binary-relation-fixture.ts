// Test-only builders: a BinaryRelation with sane defaults (overridable
// per field) and a BinariesData assembled from a relation list.

import { NO_PARENT, type BinariesData, type BinaryRelation } from './binaries-loader';

export function makeRelation(overrides: Partial<BinaryRelation> = {}): BinaryRelation {
  return {
    primaryIdx: 0,
    secondaryIdx: 1,
    flags: 0,
    parentRelation: NO_PARENT,
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
    ...overrides,
  };
}

/** BinariesData over `relations`, index maps built the way the loader
 *  builds them. */
export function makeBinaries(relations: BinaryRelation[]): BinariesData {
  const primaryIdxToRelations = new Map<number, number[]>();
  const secondaryIdxToRelations = new Map<number, number[]>();
  relations.forEach((r, i) => {
    const pArr = primaryIdxToRelations.get(r.primaryIdx);
    if (pArr) pArr.push(i);
    else primaryIdxToRelations.set(r.primaryIdx, [i]);
    const sArr = secondaryIdxToRelations.get(r.secondaryIdx);
    if (sArr) sArr.push(i);
    else secondaryIdxToRelations.set(r.secondaryIdx, [i]);
  });
  return { version: 1, relations, primaryIdxToRelations, secondaryIdxToRelations };
}
