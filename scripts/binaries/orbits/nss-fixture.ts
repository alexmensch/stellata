// Test-only builders for NSS two-body orbit rows.

import { DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import type { NssOrbitRow } from '../load/gaia-pure';

/** Halbwachs 2023 (/data/papers/index.md#halbwachs2023) Eq. A.1: the forward
 *  transform `thieleInnesToCampbell` inverts. */
export function tiFromCampbell(aMas: number, iRad: number, nodeRad: number, periastronRad: number): [number, number, number, number] {
  const co = Math.cos(periastronRad);
  const so = Math.sin(periastronRad);
  const cO = Math.cos(nodeRad);
  const sO = Math.sin(nodeRad);
  const ci = Math.cos(iRad);
  return [
    aMas * (co * cO - so * sO * ci),
    aMas * (co * sO + so * cO * ci),
    aMas * (-so * cO - co * sO * ci),
    aMas * (-so * sO + co * cO * ci),
  ];
}

export function nssRow(over: Partial<NssOrbitRow> = {}): NssOrbitRow {
  return {
    sourceId: '1', solutionType: 'SB1', period: null, tPeriastron: null, eccentricity: null,
    aThieleInnes: null, bThieleInnes: null, fThieleInnes: null, gThieleInnes: null,
    inclination: null, argPeriastron: null, massRatio: null,
    ...over,
  };
}

/** An `Orbital` solution whose Thiele-Innes constants encode the given Campbell elements. */
export function nssOrbitalRow(over: {
  sourceId?: string; aMas?: number; iDeg?: number; nodeDeg?: number; periastronDeg?: number;
  periodDays?: number; tPeriastronRelDays?: number; eccentricity?: number;
} = {}): NssOrbitRow {
  const [A, B, F, G] = tiFromCampbell(
    over.aMas ?? 12.5, (over.iDeg ?? 57.3) * DEG_TO_RAD, (over.nodeDeg ?? 110) * DEG_TO_RAD, (over.periastronDeg ?? 45) * DEG_TO_RAD,
  );
  return nssRow({
    sourceId: over.sourceId ?? '1', solutionType: 'Orbital',
    period: over.periodDays ?? 365, tPeriastron: over.tPeriastronRelDays ?? 100, eccentricity: over.eccentricity ?? 0.1,
    aThieleInnes: A, bThieleInnes: B, fThieleInnes: F, gThieleInnes: G,
  });
}
