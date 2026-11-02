// Observing-instrument records: aperture, PSF, sky background, and the
// limiting magnitude and summation area they imply. See README.md.

import { rodSummationSolidAngleArcsec2 } from './emission/emission-pure';

export type InstrumentName = 'unaided-eye';

/**
 * An observing instrument: aperture plus the data aperture cannot
 * supply. Everything a renderer reads off it is either a field here or
 * derived from one — `/docs/science-hdr-pipeline.md#34-the-instrument-record--aperture-is-the-single-number`.
 */
export interface Instrument {
  apertureMm: number;
  defaultFovDeg: number;
  /** PSF width on the sky. */
  psfArcsec: number;
  /** Crowding half of the exaggeration K — the plate-scale half is
   *  derived per frame by the viewer's `starPxSizes`. */
  kDensity: number;
  /** Magnitude window the footprint curve grows across. NOT display
   *  dynamic range — that is the tone-map's `DR_MAG` (`tonemap/README.md#operator`).
   * */
  sizeSpan: number;
  /** Doubles as the extended-source detection threshold
   *  (`extendedThresholdSbFor`). */
  skyBackgroundMagArcsec2: number;
  /** No consumer yet — the instrument record's remaining preset axis (/docs/science-hdr-pipeline.md#34-the-instrument-record--aperture-is-the-single-number). */
  passband: 'V';
}

// The reference observer: a 7 mm dark-adapted pupil reaching m 7.8 in
// vacuum under a Bortle-1 sky. Aperture and limit are anchored together
// because σ = 30″ is derived at that same pupil.
const EYE_APERTURE_MM = 7;
const EYE_LIMIT_MAG = 7.8;

/** Limiting magnitude from aperture — collecting area goes as D², so
 *  every doubling of aperture buys 1.5 magnitudes. */
export function limitMagForAperture(apertureMm: number): number {
  return EYE_LIMIT_MAG + 5 * Math.log10(apertureMm / EYE_APERTURE_MM);
}

export const INSTRUMENTS: Record<InstrumentName, Instrument> = {
  'unaided-eye': {
    apertureMm: EYE_APERTURE_MM,
    defaultFovDeg: 50,
    psfArcsec: 30,
    kDensity: 1,
    sizeSpan: 8,
    skyBackgroundMagArcsec2: 22,
    passband: 'V',
  },
};

export const DEFAULT_INSTRUMENT: InstrumentName = 'unaided-eye';

export function instrumentLimitMag(name: InstrumentName): number {
  return limitMagForAperture(INSTRUMENTS[name].apertureMm);
}

/**
 * The extended-source sibling of `instrumentLimitMag`: the surface
 * brightness at which a large diffuse source is at the edge of detection.
 *
 * It **is** the instrument's sky background: threshold contrast for a
 * large, soft, scotopic target is of order unity.
 * `/docs/science-hdr-pipeline.md#1-the-unit--threshold-anchored-display-luminance` (*Extended sources*)
 * carries the derivation and the summation area it implies.
 */
export function extendedThresholdSbFor(name: InstrumentName): number {
  return INSTRUMENTS[name].skyBackgroundMagArcsec2;
}

/** The summation area implied by pairing an instrument's extended-source
 *  threshold (`extendedThresholdSbFor`) with its point-source limit. Static
 *  in the exposure state: adaptation and the
 *  trim move both thresholds together, so their offset is the instrument's
 *  alone. Why that threshold is the sky background:
 *  `/docs/science-hdr-pipeline.md#1-the-unit--threshold-anchored-display-luminance` (*Extended sources*). */
export function summationSolidAngleFor(name: InstrumentName): number {
  return rodSummationSolidAngleArcsec2(
    extendedThresholdSbFor(name),
    instrumentLimitMag(name),
  );
}

export const DEFAULT_SUMMATION_ARCSEC2 = summationSolidAngleFor(DEFAULT_INSTRUMENT);
