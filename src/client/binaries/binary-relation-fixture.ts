// Test-only builder for a BinaryRelation with sane defaults, overridable
// per field. Shared by the focal-chain and orbit-path unit tests.

import { NO_PARENT, type BinaryRelation } from './binaries-loader';

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
