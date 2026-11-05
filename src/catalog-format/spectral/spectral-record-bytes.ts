// SpectralInfo to and from the record's class bytes.
// See README.md#spectralinfo-is-a-variant.

import {
  type LumClass,
  type MkLetter,
  type SpectralInfo,
} from './spectral-classify';

/** spectClass 0-6 are the MK letters O-M. */
export const SPECT_CLASS_CARBON = 7;
export const SPECT_CLASS_UNKNOWN = 8;
/** lumClass 0-9 are `LumClass`; 0 is also every white dwarf's. */
export const LUM_CLASS_WHITE_DWARF = 0;
export const LUM_CLASS_UNKNOWN = 255;

export interface SpectralBytes {
  spectClass: number;
  lumClass: number;
}

export function encodeSpectralBytes(info: SpectralInfo): SpectralBytes {
  switch (info.kind) {
    case 'mk': return { spectClass: info.letter, lumClass: info.lumClass ?? LUM_CLASS_UNKNOWN };
    case 'carbon':
    case 'wolf-rayet': return { spectClass: SPECT_CLASS_CARBON, lumClass: LUM_CLASS_UNKNOWN };
    case 'white-dwarf': return { spectClass: SPECT_CLASS_UNKNOWN, lumClass: LUM_CLASS_WHITE_DWARF };
    case 'unknown': return { spectClass: SPECT_CLASS_UNKNOWN, lumClass: LUM_CLASS_UNKNOWN };
  }
}

export function decodeSpectralBytes({ spectClass, lumClass }: SpectralBytes): SpectralInfo {
  if (lumClass === LUM_CLASS_WHITE_DWARF) {
    return { kind: 'white-dwarf', wdSubclass: null };
  }
  if (spectClass === SPECT_CLASS_CARBON) return { kind: 'carbon', subclass: null };
  if (spectClass === SPECT_CLASS_UNKNOWN) return { kind: 'unknown' };
  if (!Number.isInteger(spectClass) || spectClass < 0 || spectClass >= SPECT_CLASS_CARBON) {
    throw new Error(`spectClass byte ${spectClass} encodes no class`);
  }
  if (lumClass !== LUM_CLASS_UNKNOWN && !(Number.isInteger(lumClass) && lumClass >= 0 && lumClass <= 9)) {
    throw new Error(`lumClass byte ${lumClass} encodes no luminosity class`);
  }
  return {
    kind: 'mk',
    letter: spectClass as MkLetter,
    subclass: null,
    lumClass: lumClass === LUM_CLASS_UNKNOWN ? null : (lumClass as LumClass),
  };
}
