// The positional witness. See README.md.

import {
  angularSeparationArcsec, polarToTangent, skyPositionAtEpoch, unitVectorFromRaDec,
  type SkyPosition,
} from '../../../../src/astro-core/equatorial-basis';
import {
  besselianEpochToJd, julianYearOfJd, precessionRotationFromJ2000, unprecessRaDec,
} from '../../../../src/astro-core/precession';
import { ascending } from '../../../../src/astro-core/order-pure';
import type { V70aAstrometry } from '../../gliese-parse-pure';
import type { Hip2AstrometryRow } from '../../sources/hip2-source';
import { TYCHO2_ICRS_EPOCH, type Tycho2Row } from '../../tycho2-parse';

/** In the 13.8″ → 20.6″ gap of the measured separations (README.md#the-tolerances). */
export const V70A_WITNESS_TOLERANCE_ARCSEC = 15;

/** See README.md#the-tolerances. */
export const HIPPARCOS_WITNESS_TOLERANCE_ARCSEC = 0.5;

const B1950_JD = besselianEpochToJd(1950);
const B1950_JULIAN_YEAR = julianYearOfJd(B1950_JD);
const B1950_TO_J2000 = precessionRotationFromJ2000(B1950_JD);

export interface WitnessSeparation {
  tyc: string;
  separationArcsec: number;
}

/** `separations` lists every candidate, nearest first. */
export type WitnessVerdict =
  | { kind: 'match'; tyc: string; separations: readonly WitnessSeparation[] }
  | { kind: 'none'; separations: readonly WitnessSeparation[] }
  | { kind: 'several'; tycs: readonly string[]; separations: readonly WitnessSeparation[] };

function verdictOf(
  witness: (entry: Tycho2Row) => number,
  candidates: readonly Tycho2Row[],
  toleranceArcsec: number,
): WitnessVerdict {
  const separations = candidates
    .map((entry) => ({ tyc: entry.ref.row, separationArcsec: witness(entry) }))
    .sort((a, b) => ascending(a.separationArcsec, b.separationArcsec) || ascending(a.tyc, b.tyc));
  const inside = separations.filter((s) => s.separationArcsec <= toleranceArcsec).map((s) => s.tyc);
  if (inside.length === 0) return { kind: 'none', separations };
  if (inside.length === 1) return { kind: 'match', tyc: inside[0], separations };
  return { kind: 'several', tycs: inside, separations };
}

function separationArcsec(a: SkyPosition, b: SkyPosition): number {
  return angularSeparationArcsec(
    unitVectorFromRaDec(a.raDeg, a.decDeg), unitVectorFromRaDec(b.raDeg, b.decDeg),
  );
}

/** README.md#the-two-witnesses. */
function singleStarPosition(entry: Tycho2Row): { position: SkyPosition; epoch: number } {
  return entry.isPhotocentre
    ? { position: entry.observed, epoch: TYCHO2_ICRS_EPOCH }
    : { position: { raDeg: entry.raDeg, decDeg: entry.decDeg }, epoch: entry.epoch };
}

/** Carried in the B1950 frame, then precessed: README.md#the-two-witnesses. */
export function v70aPositionAt(astrometry: V70aAstrometry, epoch: number): SkyPosition {
  const { eastArcsec, northArcsec } = polarToTangent(astrometry.pmArcsecYr, astrometry.pmPaDeg);
  const carried = skyPositionAtEpoch(
    { raDeg: astrometry.raB1950Deg, decDeg: astrometry.decB1950Deg },
    { pmRaMasyr: eastArcsec * 1000, pmDecMasyr: northArcsec * 1000 },
    B1950_JULIAN_YEAR,
    epoch,
  );
  return unprecessRaDec(B1950_TO_J2000, carried);
}

export function witnessV70a(
  astrometry: V70aAstrometry, candidates: readonly Tycho2Row[],
): WitnessVerdict {
  return verdictOf((entry) => {
    const { position, epoch } = singleStarPosition(entry);
    return separationArcsec(v70aPositionAt(astrometry, epoch), position);
  }, candidates, V70A_WITNESS_TOLERANCE_ARCSEC);
}

export function witnessHipparcos(
  hip: Pick<Hip2AstrometryRow, 'raDeg' | 'decDeg'>, candidates: readonly Tycho2Row[],
): WitnessVerdict {
  return verdictOf(
    (entry) => separationArcsec(hip, entry.observed),
    candidates,
    HIPPARCOS_WITNESS_TOLERANCE_ARCSEC,
  );
}
