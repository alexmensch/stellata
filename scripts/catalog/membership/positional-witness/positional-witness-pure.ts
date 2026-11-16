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
import { HIPPARCOS_EPOCH_JYEAR } from '../../../../src/astro-core/astronomy-constants';
import type { ObservedPosition, Tycho2Row } from '../../tycho2-parse';

/** In the 13.8″ → 20.6″ gap of the measured separations (README.md#the-tolerances). */
export const V70A_WITNESS_TOLERANCE_ARCSEC = 15;

/** See README.md#the-tolerances. */
export const HIPPARCOS_WITNESS_TOLERANCE_ARCSEC = 0.4;

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

type PositionAt = (epoch: number) => SkyPosition;

/** Each coordinate of the source carried to the epoch its observed counterpart was measured at. */
function separationFromObserved(at: PositionAt, observed: ObservedPosition): number {
  return separationArcsec({ raDeg: at(observed.raEpoch).raDeg, decDeg: at(observed.decEpoch).decDeg }, observed);
}

/** README.md#the-two-witnesses. */
function separationFromSingleStar(at: PositionAt, entry: Tycho2Row): number {
  if (entry.isPhotocentre || entry.fromIcrs) return separationFromObserved(at, entry.observed);
  return separationArcsec(at(entry.epoch), entry);
}

/** Carried in the B1950 frame, then precessed: README.md#the-two-witnesses. */
function v70aPositionAt(astrometry: V70aAstrometry, epoch: number): SkyPosition {
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
  const at: PositionAt = (epoch) => v70aPositionAt(astrometry, epoch);
  return verdictOf((entry) => separationFromSingleStar(at, entry), candidates, V70A_WITNESS_TOLERANCE_ARCSEC);
}

/** HIP2's position and proper motion, both required: the carry has nothing to carry by without them. */
export interface HipparcosAstrometry {
  raDeg: number;
  decDeg: number;
  pmRaMasyr: number;
  pmDeMasyr: number;
}

/** Null where HIP2 publishes no proper motion. */
export function hipparcosAstrometry(row: Hip2AstrometryRow): HipparcosAstrometry | null {
  const { raDeg, decDeg, pmRaMasyr, pmDeMasyr } = row;
  return pmRaMasyr === null || pmDeMasyr === null ? null : { raDeg, decDeg, pmRaMasyr, pmDeMasyr };
}

export function witnessHipparcos(hip: HipparcosAstrometry, candidates: readonly Tycho2Row[]): WitnessVerdict {
  const at: PositionAt = (epoch) => skyPositionAtEpoch(
    hip, { pmRaMasyr: hip.pmRaMasyr, pmDecMasyr: hip.pmDeMasyr }, HIPPARCOS_EPOCH_JYEAR, epoch,
  );
  return verdictOf((entry) => separationFromObserved(at, entry.observed), candidates, HIPPARCOS_WITNESS_TOLERANCE_ARCSEC);
}
